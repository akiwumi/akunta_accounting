/**
 * Manual journal entries (bokföringsorder).
 *
 * Every manual entry, guided or free, is written by createJournalEntry. It
 * checks what the database triggers check (balanced, non-negative one-sided
 * lines, no locked period) so the user gets a clear message instead of a
 * trigger error, and adds what only the application knows: the accounts must
 * belong to the business and be active.
 *
 * VAT. The VAT return (lib/tax/momsdeklaration.ts) takes its boxes from each
 * Transaction's direction, netAmount and vatAmount, and compares them with
 * what was booked on the VAT accounts (2610 to 2649). An entry that touches
 * 2650 is a settlement and is left out of that comparison. So:
 *
 *   - A plain manual entry is a TRANSFER with no VAT amount. If it books on a
 *     VAT account without also touching 2650, the return and the ledger would
 *     disagree. That is refused unless the caller acknowledges the warning.
 *   - The VAT settlement template books through 2650, so it is recognised as
 *     a settlement.
 *   - The year-end entries for unpaid invoices under kontantmetoden are sales
 *     and purchases whose VAT belongs in the last return of the year. They
 *     pass `vatReturn`, which makes the entry an INCOME or EXPENSE entry with
 *     a VAT amount, exactly like a receipt or an invoice payment. The VAT
 *     booked on the lines must then equal that VAT amount.
 */

import { type Prisma } from "@prisma/client";

import { assertDateNotLocked, LedgerError, writeLedgerAudit } from "@/lib/accounting/ledger";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

type Db = Prisma.TransactionClient;

export type JournalErrorCode =
  | "DESCRIPTION"
  | "DATE"
  | "TOO_FEW_LINES"
  | "LINE_AMOUNT"
  | "UNBALANCED"
  | "ACCOUNT_FOREIGN"
  | "ACCOUNT_INACTIVE"
  | "LOCKED"
  | "VAT_ACCOUNTS"
  | "VAT_MISMATCH"
  | "INPUT";

export class JournalError extends LedgerError {
  constructor(
    public readonly code: JournalErrorCode,
    message: string,
    status = 422
  ) {
    super(message, status);
    this.name = "JournalError";
  }
}

export type JournalLineInput = {
  accountId: string;
  debit: number;
  credit: number;
  note?: string | null;
};

/** How the entry is reported in the VAT return. Only for entries that are a sale or a purchase. */
export type JournalVatReturn = {
  direction: "INCOME" | "EXPENSE";
  /** Amount excluding VAT. Negative on a reversal. */
  netAmount: number;
  /** VAT amount. Negative on a reversal. */
  vatAmount: number;
  /** 0.25, 0.12, 0.06 or 0. */
  vatRate: number;
};

export type JournalEntryInput = {
  businessId: string;
  userId?: string | null;
  txnDate: Date;
  description: string;
  reference?: string | null;
  lines: JournalLineInput[];
  /** Name of the guided template that produced the entry, for the audit trail. */
  template?: string | null;
  vatReturn?: JournalVatReturn;
  /** The user has read the warning about booking on VAT accounts outside a settlement. */
  acknowledgeVatWarning?: boolean;
};

export const VAT_SETTLEMENT_ACCOUNT_CODE = "2650";
export const isOutputVatAccountCode = (code: string) => /^26[123]\d$/.test(code);
export const isInputVatAccountCode = (code: string) => /^264\d$/.test(code);
export const isVatAccountCode = (code: string) => isOutputVatAccountCode(code) || isInputVatAccountCode(code);

/**
 * True when an entry on these accounts books VAT without being a settlement,
 * which the VAT return cannot see unless the entry is a sale or a purchase.
 */
export const booksVatOutsideSettlement = (accountCodes: string[]): boolean =>
  accountCodes.some(isVatAccountCode) && !accountCodes.includes(VAT_SETTLEMENT_ACCOUNT_CODE);

const toOre = (value: number): number => Math.round(value * 100);
const fromOre = (ore: number): number => ore / 100;
const formatOre = (ore: number): string => fromOre(ore).toFixed(2);

/**
 * Pure checks on the lines of an entry. Returns the totals in öre.
 * Throws a JournalError that says what is wrong.
 */
export const checkJournalLines = (lines: Array<{ debit: number; credit: number }>) => {
  if (lines.length < 2) {
    throw new JournalError("TOO_FEW_LINES", "An entry needs at least two lines: one debit and one credit.");
  }
  let debitOre = 0;
  let creditOre = 0;
  lines.forEach((line, index) => {
    if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0) {
      throw new JournalError("LINE_AMOUNT", `Line ${index + 1}: amounts cannot be negative. Use the other column instead.`);
    }
    const debit = toOre(line.debit);
    const credit = toOre(line.credit);
    if (debit > 0 && credit > 0) {
      throw new JournalError("LINE_AMOUNT", `Line ${index + 1}: a line is either debit or credit, not both.`);
    }
    if (debit === 0 && credit === 0) {
      throw new JournalError("LINE_AMOUNT", `Line ${index + 1}: the line has no amount.`);
    }
    debitOre += debit;
    creditOre += credit;
  });
  if (debitOre !== creditOre) {
    throw new JournalError(
      "UNBALANCED",
      `The entry does not balance: debit ${formatOre(debitOre)} and credit ${formatOre(creditOre)} differ by ${formatOre(Math.abs(debitOre - creditOre))}.`
    );
  }
  return { debitOre, creditOre };
};

const isValidDate = (date: Date) =>
  date instanceof Date && !Number.isNaN(date.valueOf()) && date.getUTCFullYear() >= 1990 && date.getUTCFullYear() <= 2100;

/**
 * Book one manual entry inside the caller's database transaction.
 *
 * The verification number is assigned by the database. The audit row is
 * written in the same transaction, so an entry never exists without one.
 */
export const createJournalEntry = async (db: Db, input: JournalEntryInput) => {
  const description = input.description.replace(/\s+/g, " ").trim();
  if (description.length === 0) {
    throw new JournalError("DESCRIPTION", "Write a short text that says what the entry is about.");
  }
  if (description.length > 200) {
    throw new JournalError("DESCRIPTION", "The text can be at most 200 characters.");
  }
  if (!isValidDate(input.txnDate)) {
    throw new JournalError("DATE", "Choose a valid date.");
  }

  const lines = input.lines.map((line) => ({
    accountId: line.accountId,
    debit: fromOre(toOre(line.debit)),
    credit: fromOre(toOre(line.credit)),
    note: line.note?.trim() || null
  }));
  const { debitOre } = checkJournalLines(lines);

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds }, businessId: input.businessId },
    select: { id: true, code: true, name: true, isActive: true }
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  if (accountById.size !== accountIds.length) {
    throw new JournalError("ACCOUNT_FOREIGN", "One of the accounts does not exist in this business's chart of accounts.");
  }
  const inactive = accounts.find((account) => !account.isActive);
  if (inactive) {
    throw new JournalError(
      "ACCOUNT_INACTIVE",
      `Account ${inactive.code} ${inactive.name} is inactive. Reactivate it in the chart of accounts or choose another account.`
    );
  }

  try {
    await assertDateNotLocked(db, input.businessId, input.txnDate);
  } catch (error) {
    if (error instanceof LedgerError) throw new JournalError("LOCKED", error.message, 409);
    throw error;
  }

  // VAT booked on the lines, the way the VAT return's cross-check reads it.
  const codes = lines.map((line) => accountById.get(line.accountId)!.code);
  let outputVatOre = 0;
  let inputVatOre = 0;
  lines.forEach((line, index) => {
    if (isOutputVatAccountCode(codes[index])) outputVatOre += toOre(line.credit) - toOre(line.debit);
    else if (isInputVatAccountCode(codes[index])) inputVatOre += toOre(line.debit) - toOre(line.credit);
  });

  let amounts = {
    direction: TransactionDirections.TRANSFER as string,
    grossAmount: fromOre(debitOre),
    netAmount: fromOre(debitOre),
    vatAmount: 0,
    vatRate: 0
  };

  if (input.vatReturn) {
    const vat = input.vatReturn;
    const vatOre = toOre(vat.vatAmount);
    const matches =
      !codes.includes(VAT_SETTLEMENT_ACCOUNT_CODE) &&
      (vat.direction === "INCOME"
        ? outputVatOre === vatOre && inputVatOre === 0
        : inputVatOre === vatOre && outputVatOre === 0);
    if (!matches) {
      throw new JournalError(
        "VAT_MISMATCH",
        "The VAT booked on the lines does not match the VAT amount reported for the entry.",
        500
      );
    }
    amounts = {
      direction: vat.direction,
      grossAmount: fromOre(toOre(vat.netAmount) + vatOre),
      netAmount: fromOre(toOre(vat.netAmount)),
      vatAmount: fromOre(vatOre),
      vatRate: vat.vatRate
    };
  } else if (booksVatOutsideSettlement(codes) && !input.acknowledgeVatWarning) {
    throw new JournalError(
      "VAT_ACCOUNTS",
      "This entry books on a VAT account. VAT booked here does not reach the VAT return. Enter sales and purchases with VAT as a receipt, payment or invoice instead, or confirm that you want to book it anyway."
    );
  }

  const transaction = await db.transaction.create({
    data: {
      businessId: input.businessId,
      txnDate: input.txnDate,
      description,
      ...amounts,
      currency: "SEK",
      source: EntrySources.JOURNAL,
      reference: input.reference?.trim() || null,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          note: line.note
        }))
      }
    },
    include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } }
  });

  await writeLedgerAudit(db, {
    businessId: input.businessId,
    userId: input.userId,
    entityType: "Transaction",
    entityId: transaction.id,
    action: "JOURNAL_ENTRY",
    after: {
      verificationNumber: transaction.verificationNumber,
      txnDate: input.txnDate.toISOString().slice(0, 10),
      description,
      template: input.template ?? null,
      direction: amounts.direction,
      vatAmount: amounts.vatAmount,
      vatWarningAcknowledged: !input.vatReturn && booksVatOutsideSettlement(codes),
      lines: lines.map((line, index) => ({ account: codes[index], debit: line.debit, credit: line.credit }))
    }
  });

  return transaction;
};

/** Book one or more manual entries together: either all are booked or none. */
export const postJournalEntries = async (entries: JournalEntryInput[]) =>
  prisma.$transaction(async (tx) => {
    const created = [];
    for (const entry of entries) created.push(await createJournalEntry(tx, entry));
    return created;
  });

/** The latest manual entries of a business, newest first. */
export const listRecentJournalEntries = async (businessId: string, take = 10) =>
  prisma.transaction.findMany({
    where: { businessId, source: EntrySources.JOURNAL },
    orderBy: [{ createdAt: "desc" }, { verificationNumber: "desc" }],
    take,
    select: {
      id: true,
      verificationNumber: true,
      txnDate: true,
      description: true,
      grossAmount: true,
      voidedAt: true,
      lines: {
        select: { debit: true, credit: true, account: { select: { code: true, name: true } } }
      }
    }
  });
