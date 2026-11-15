/**
 * Ledger rules that every write path must follow.
 *
 * Bokföringslagen (ch. 5) forbids deleting or altering a booked verification.
 * A mistake is corrected by booking a second verification that reverses the
 * first, and both stay visible. The database enforces the same rules with
 * triggers (see prisma/migrations/*_ledger_hardening); the helpers here give
 * callers a clean way to stay inside them.
 *
 * A reversal carries the same direction as the original with negated amounts
 * and swapped journal lines, so any report that sums by direction or by
 * account nets the pair to zero without special handling.
 */

import { Prisma } from "@prisma/client";

import { EntrySources } from "@/lib/domain/enums";

type Db = Prisma.TransactionClient;

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly status: number = 409
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Where clause for entries that are still in force (not cancelled, not a correction). */
export const ACTIVE_TRANSACTION = { voidedAt: null, reversesTransactionId: null } as const;

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const isDateLocked = async (db: Db, businessId: string, date: Date): Promise<boolean> => {
  const lock = await db.periodLock.findFirst({
    where: { businessId, periodStart: { lte: date }, periodEnd: { gte: date } },
    select: { id: true }
  });
  return lock !== null;
};

export const assertDateNotLocked = async (db: Db, businessId: string, date: Date): Promise<void> => {
  if (await isDateLocked(db, businessId, date)) {
    throw new LedgerError(
      `The date ${date.toISOString().slice(0, 10)} falls within a locked accounting period.`
    );
  }
};

/** Audit row written inside the caller's database transaction, so it cannot be lost. */
export const writeLedgerAudit = async (
  db: Db,
  params: {
    businessId: string;
    userId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }
) => {
  await db.auditLog.create({
    data: {
      businessId: params.businessId,
      userId: params.userId ?? undefined,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      beforeJson: params.before !== undefined ? JSON.stringify(params.before) : undefined,
      afterJson: params.after !== undefined ? JSON.stringify(params.after) : undefined
    }
  });
};

/**
 * Cancel a booked verification by booking its reversal.
 *
 * The reversal is dated the same day as the original. If that day is in a
 * locked period the correction belongs to the current period and is dated
 * today instead.
 */
export const voidTransaction = async (
  db: Db,
  params: { businessId: string; transactionId: string; userId?: string | null; reason: string }
) => {
  const original = await db.transaction.findFirst({
    where: { id: params.transactionId, businessId: params.businessId },
    include: { lines: true }
  });
  if (!original) throw new LedgerError("Transaction not found.", 404);
  if (original.voidedAt) throw new LedgerError("This verification has already been cancelled.");
  if (original.reversesTransactionId) {
    throw new LedgerError("A correcting entry cannot itself be cancelled. Book a new entry.");
  }

  let reversalDate = original.txnDate;
  if (await isDateLocked(db, params.businessId, reversalDate)) {
    reversalDate = todayUtc();
    await assertDateNotLocked(db, params.businessId, reversalDate);
  }

  // The description is stored, so it follows the language the business keeps its books in.
  const business = await db.business.findUnique({ where: { id: params.businessId }, select: { locale: true } });
  const correctionLabel =
    business?.locale === "sv"
      ? `Rättelse av verifikation ${original.verificationNumber}`
      : `Correction of verification ${original.verificationNumber}`;

  const reversal = await db.transaction.create({
    data: {
      businessId: original.businessId,
      receiptId: original.receiptId,
      txnDate: reversalDate,
      description: `${correctionLabel}: ${original.description}`.slice(0, 200),
      direction: original.direction,
      grossAmount: original.grossAmount.negated(),
      netAmount: original.netAmount.negated(),
      vatAmount: original.vatAmount.negated(),
      vatRate: original.vatRate,
      currency: original.currency,
      sourceCurrency: original.sourceCurrency,
      fxRateToSek: original.fxRateToSek,
      fxRateDate: original.fxRateDate,
      source: EntrySources.CORRECTION,
      reference: original.reference,
      reversesTransactionId: original.id,
      lines: {
        create: original.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
          note: line.note
        }))
      }
    }
  });

  // paidInvoiceId is unique, so release it: the invoice may be paid again later.
  await db.transaction.update({
    where: { id: original.id },
    data: {
      voidedAt: new Date(),
      voidedByUserId: params.userId ?? null,
      voidReason: params.reason.slice(0, 500),
      paidInvoiceId: null
    }
  });

  await writeLedgerAudit(db, {
    businessId: params.businessId,
    userId: params.userId,
    entityType: "Transaction",
    entityId: original.id,
    action: "VOID",
    before: {
      verificationNumber: original.verificationNumber,
      txnDate: original.txnDate,
      description: original.description,
      grossAmount: original.grossAmount.toString(),
      paidInvoiceId: original.paidInvoiceId
    },
    after: {
      reason: params.reason,
      reversalId: reversal.id,
      reversalVerificationNumber: reversal.verificationNumber,
      reversalDate
    }
  });

  return { original, reversal };
};

/** Maps ledger failures (ours and the database triggers') to an HTTP status and message. */
export const ledgerErrorResponse = (error: unknown): { status: number; message: string } | null => {
  if (error instanceof LedgerError) return { status: error.status, message: error.message };
  const text = error instanceof Error ? error.message : "";
  if (text.includes("LEDGER_PERIOD_LOCKED")) {
    return { status: 409, message: "The date falls within a locked accounting period." };
  }
  if (text.includes("LEDGER_IMMUTABLE")) {
    return { status: 409, message: "A booked verification cannot be changed. Book a correcting entry instead." };
  }
  if (text.includes("LEDGER_UNBALANCED")) {
    return { status: 422, message: "The entry does not balance: debit and credit must be equal." };
  }
  return null;
};
