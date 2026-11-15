/**
 * ROT and RUT against the database: which invoices are ready to be requested
 * from Skatteverket, marking a request as sent, and booking the payout.
 *
 * Bookkeeping (kontantmetoden, enskild firma). Nothing is booked when the
 * invoice is issued. Income and output VAT follow the money:
 * - When the customer pays their part: bank (1930) debit, sales (3001) and
 *   output VAT (2610) credit, on what the customer paid. This is the ordinary
 *   payment entry.
 * - When Skatteverket pays out: the same entry on the amount received, on
 *   the day it arrived. The VAT in Skatteverket's part is reported in that
 *   period, not earlier.
 * Skatteverket, "Så fungerar rotavdraget", example "Räkna ut rotavdrag och
 * redovisa moms": a business using bokslutsmetoden reports the VAT in two
 * steps, on the customer's payment and then on the payout.
 * https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut/safungerarrotavdraget.4.2ef18e6a125660db8b080002709.html
 * Bokio books the payout the same way (bank against sales and output VAT):
 * https://www.bokio.se/hjalp/fakturera-kunder/rot-och-rut/bokfor-rot-rut-utbetalning-fran-skatteverket/
 * Under fakturametoden the whole invoice is booked at issue, with
 * Skatteverket's part on 1513 Kundfordringar - delad faktura. The accrual
 * invoice flow in this app is not complete, so ROT/RUT is refused there.
 *
 * If Skatteverket pays less than requested (the customer's yearly allowance
 * was used up), only what arrived is booked, and the difference becomes the
 * customer's to pay: the invoice is open again for that amount.
 */

import { type Prisma, type PrismaClient } from "@prisma/client";

import { voidTransaction } from "@/lib/accounting/ledger";
import { asNumber, round2 } from "@/lib/accounting/math";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { invoiceAmounts, storedStatusFor } from "@/lib/invoices/balance";
import {
  buildRotRutCase,
  buildRotRutRequestXml,
  isRotRutType,
  maskPersonnummer,
  parseRotRutDetails,
  type RotRutCase,
  rotRutDeadline,
  rotRutDeadlineState,
  RotRutError,
  ROT_RUT_MAX_CASES_PER_FILE,
  rotRutSchemaVersionFor,
  rotRutStage,
  type RotRutStage,
  type RotRutType,
  toTwelveDigitId
} from "@/lib/invoices/rotrut";

const rotRutInclude = {
  payments: {
    select: { amount: true, paymentDate: true, transaction: { select: { voidedAt: true } } },
    orderBy: { paymentDate: "asc" }
  },
  creditNotes: {
    select: { id: true, amount: true, issueDate: true, createdAt: true, transaction: { select: { voidedAt: true } } }
  },
  items: { orderBy: { sortOrder: "asc" } }
} satisfies Prisma.InvoiceInclude;

type RotRutInvoice = Prisma.InvoiceGetPayload<{ include: typeof rotRutInclude }>;

const lastPaymentDate = (invoice: RotRutInvoice) => {
  const active = invoice.payments.filter((payment) => !payment.transaction?.voidedAt);
  return active.length > 0 ? active[active.length - 1].paymentDate : null;
};

const stageOf = (invoice: RotRutInvoice) => {
  const amounts = invoiceAmounts(invoice);
  const stage = rotRutStage({
    rotRutType: invoice.rotRutType,
    status: invoice.status,
    creditedAmount: amounts.creditedAmount,
    remaining: amounts.remainingAmount,
    rotRutRequestedAt: invoice.rotRutRequestedAt,
    rotRutPaidOutAt: invoice.rotRutPaidOutAt
  });
  return { amounts, stage };
};

const caseOf = (invoice: RotRutInvoice): RotRutCase | null => {
  const details = parseRotRutDetails(invoice.rotRutDetailsJson);
  const paymentDate = lastPaymentDate(invoice);
  if (!isRotRutType(invoice.rotRutType) || !details || !paymentDate) return null;
  return buildRotRutCase({
    type: invoice.rotRutType,
    invoiceNumber: invoice.invoiceNumber,
    details,
    deduction: asNumber(invoice.rotRutDeduction ?? 0),
    paymentDate,
    lines: invoice.items.map((item) => ({
      totalAmount: asNumber(item.totalAmount),
      labour: item.rotRutLabour,
      workType: item.rotRutWorkType,
      hours: item.rotRutHours === null ? null : asNumber(item.rotRutHours)
    }))
  });
};

export type RotRutQueueRow = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  /** Masked: the full number is only in the request file and on the invoice. */
  buyer: string;
  type: RotRutType;
  stage: RotRutStage;
  deduction: number;
  /** YYYY-MM-DD, the customer's last payment. Null until they have paid. */
  paymentDate: string | null;
  paymentYear: number | null;
  /** YYYY-MM-DD: 31 January the year after the payment. */
  deadline: string | null;
  daysLeft: number | null;
  deadlineSoon: boolean;
  deadlinePassed: boolean;
  requestedAt: string | null;
};

/** Every ROT/RUT invoice Skatteverket has not paid yet, with where it stands. Cancelled ones are left out. */
export const loadRotRutQueue = async (
  db: PrismaClient | Prisma.TransactionClient,
  input: { businessId: string; today: Date }
): Promise<{ rows: RotRutQueueRow[]; invoices: Map<string, RotRutInvoice> }> => {
  const invoices = await db.invoice.findMany({
    where: { businessId: input.businessId, rotRutType: { not: null }, rotRutPaidOutAt: null, status: { not: "VOID" } },
    include: rotRutInclude,
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
    take: 1000
  });
  const rows: RotRutQueueRow[] = [];
  const kept = new Map<string, RotRutInvoice>();
  for (const invoice of invoices) {
    const { stage } = stageOf(invoice);
    if (!stage || stage === "cancelled" || stage === "paid_out" || !isRotRutType(invoice.rotRutType)) continue;
    const paymentDate = lastPaymentDate(invoice);
    const deadline = paymentDate && stage !== "awaiting_customer" ? rotRutDeadline(paymentDate) : null;
    const state = deadline ? rotRutDeadlineState(deadline, input.today) : null;
    kept.set(invoice.id, invoice);
    rows.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      buyer: maskPersonnummer(parseRotRutDetails(invoice.rotRutDetailsJson)?.personnummer),
      type: invoice.rotRutType,
      stage,
      deduction: asNumber(invoice.rotRutDeduction ?? 0),
      paymentDate: paymentDate && stage !== "awaiting_customer" ? paymentDate.toISOString().slice(0, 10) : null,
      paymentYear: paymentDate && stage !== "awaiting_customer" ? paymentDate.getUTCFullYear() : null,
      deadline: deadline ? deadline.toISOString().slice(0, 10) : null,
      daysLeft: state ? state.daysLeft : null,
      // Once the request is sent, the deadline has been met.
      deadlineSoon: Boolean(state?.soon) && stage === "ready",
      deadlinePassed: Boolean(state?.passed) && stage === "ready",
      requestedAt: invoice.rotRutRequestedAt ? invoice.rotRutRequestedAt.toISOString().slice(0, 10) : null
    });
  }
  return { rows, invoices: kept };
};

/**
 * The cases for one request file: one invoice, or every invoice of one type
 * and payment year that is ready. Invoices already marked as sent are only
 * included when asked for by id (to download the same file again).
 */
export const loadRotRutCases = async (
  db: PrismaClient | Prisma.TransactionClient,
  input: { businessId: string; today: Date } & ({ invoiceId: string } | { type: RotRutType; year: number })
): Promise<{ type: RotRutType; cases: RotRutCase[]; invoiceIds: string[] }> => {
  const queue = await loadRotRutQueue(db, input);
  if ("invoiceId" in input) {
    const row = queue.rows.find((item) => item.id === input.invoiceId);
    const invoice = queue.invoices.get(input.invoiceId);
    if (!row || !invoice) {
      const exists = await db.invoice.findFirst({
        where: { id: input.invoiceId, businessId: input.businessId },
        select: { rotRutType: true }
      });
      throw new RotRutError(exists ? (exists.rotRutType ? "not_ready" : "not_rot_rut") : "not_found", exists ? 409 : 404);
    }
    if (row.stage === "awaiting_customer") throw new RotRutError("customer_unpaid", 409);
    const single = caseOf(invoice);
    if (!single) throw new RotRutError("not_ready", 409);
    return { type: row.type, cases: [single], invoiceIds: [row.id] };
  }

  const ready = queue.rows.filter(
    (row) => row.stage === "ready" && row.type === input.type && row.paymentYear === input.year
  );
  const cases: RotRutCase[] = [];
  const invoiceIds: string[] = [];
  for (const row of ready) {
    const item = caseOf(queue.invoices.get(row.id) as RotRutInvoice);
    if (!item) continue;
    cases.push(item);
    invoiceIds.push(row.id);
  }
  if (cases.length === 0) throw new RotRutError("nothing_ready", 409);
  return { type: input.type, cases, invoiceIds };
};

/**
 * The request file for the e-service: one invoice, or one part (at most 100
 * buyers) of everything ready for a type and payment year.
 */
export const buildRotRutRequestFile = async (
  db: PrismaClient | Prisma.TransactionClient,
  input: { businessId: string; today: Date; part?: number } & ({ invoiceId: string } | { type: RotRutType; year: number })
) => {
  const business = await db.business.findUnique({
    where: { id: input.businessId },
    select: { personnummer: true, invoiceSenderOrgNumber: true }
  });
  const performer = toTwelveDigitId(business?.personnummer, input.today) ?? toTwelveDigitId(business?.invoiceSenderOrgNumber, input.today);
  if (!performer) throw new RotRutError("performer_id", 409);

  const { type, cases, invoiceIds } = await loadRotRutCases(db, input);
  const part = Math.max(1, Math.trunc(input.part ?? 1));
  const from = (part - 1) * ROT_RUT_MAX_CASES_PER_FILE;
  const slice = cases.slice(from, from + ROT_RUT_MAX_CASES_PER_FILE);
  const day = input.today.toISOString().slice(0, 10);
  const xml = buildRotRutRequestXml({
    version: rotRutSchemaVersionFor(input.today),
    type,
    name: `${type} ${day}`,
    performer,
    cases: slice
  });
  const parts = Math.ceil(cases.length / ROT_RUT_MAX_CASES_PER_FILE);
  return {
    xml,
    fileName: `${type.toLowerCase()}-begaran-${day}${parts > 1 ? `-del-${part}` : ""}.xml`,
    invoiceIds: invoiceIds.slice(from, from + ROT_RUT_MAX_CASES_PER_FILE),
    parts
  };
};

const loadOne = async (db: PrismaClient | Prisma.TransactionClient, businessId: string, invoiceId: string) => {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, businessId },
    include: { ...rotRutInclude, business: { select: { bookkeepingMethod: true, locale: true } } }
  });
  if (!invoice) throw new RotRutError("not_found", 404);
  if (!isRotRutType(invoice.rotRutType)) throw new RotRutError("not_rot_rut", 409);
  return invoice;
};

/** "I have sent the request": stamps the invoices. `sent: false` takes the stamp back. */
export const markRotRutRequested = async (
  db: PrismaClient,
  input: { businessId: string; invoiceIds: string[]; sent: boolean; now?: Date }
) => {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const updated: string[] = [];
    for (const invoiceId of [...new Set(input.invoiceIds)]) {
      const invoice = await loadOne(tx, input.businessId, invoiceId);
      const { stage } = stageOf(invoice);
      if (input.sent) {
        if (stage === "requested") continue;
        if (stage === "awaiting_customer") throw new RotRutError("customer_unpaid", 409);
        if (stage !== "ready") throw new RotRutError(stage === "paid_out" ? "already_paid_out" : "credited", 409);
        await tx.invoice.update({ where: { id: invoice.id }, data: { rotRutRequestedAt: now } });
      } else {
        if (stage === "paid_out") throw new RotRutError("paid_out", 409);
        if (!invoice.rotRutRequestedAt) continue;
        await tx.invoice.update({ where: { id: invoice.id }, data: { rotRutRequestedAt: null } });
      }
      updated.push(invoice.id);
    }
    return updated;
  });
};

/**
 * "Skatteverket has paid": books what arrived, on the day it arrived, and
 * stores the entry on the invoice. An amount below the requested one leaves
 * the difference for the customer to pay; `newDueDate` then gives them a new
 * date to pay by.
 */
export const registerRotRutPayout = async (
  db: PrismaClient,
  input: { businessId: string; invoiceId: string; paidOn: Date; amount: number; newDueDate?: Date | null; today?: Date }
) => {
  const invoice = await loadOne(db, input.businessId, input.invoiceId);
  if (invoice.business.bookkeepingMethod === "fakturametoden") throw new RotRutError("accrual", 409);
  if (invoice.rotRutPaidOutAt) throw new RotRutError("already_paid_out", 409);
  const { amounts, stage } = stageOf(invoice);
  if (stage === "cancelled") throw new RotRutError(invoice.status === "VOID" ? "void" : "credited", 409);
  if (stage === "awaiting_customer") throw new RotRutError("customer_unpaid", 409);

  const deduction = asNumber(invoice.rotRutDeduction ?? 0);
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > deduction + 0.004) throw new RotRutError("payout_amount");
  const customerPaidOn = lastPaymentDate(invoice);
  if ((input.today && input.paidOn > input.today) || (customerPaidOn && input.paidOn < customerPaidOn)) {
    throw new RotRutError("payout_date");
  }

  const word = invoice.rotRutType === "ROT" ? "Rot" : "Rut";
  const transaction =
    amount > 0
      ? await createCashMethodTransaction({
          businessId: input.businessId,
          txnDate: input.paidOn,
          description:
            invoice.business.locale === "sv"
              ? `${word}utbetalning från Skatteverket, faktura ${invoice.invoiceNumber}`
              : `${invoice.rotRutType} payout from Skatteverket, invoice ${invoice.invoiceNumber}`,
          direction: TransactionDirections.INCOME,
          grossAmount: amount,
          vatRate: asNumber(invoice.vatRate),
          source: EntrySources.INVOICE_PAYMENT,
          reference: invoice.invoiceNumber,
          currency: invoice.currency,
          incomeAccountCode: "3001"
        })
      : null;

  const shortfall = round2(deduction - amount);
  const details = parseRotRutDetails(invoice.rotRutDetailsJson);
  const status = storedStatusFor({ ...amounts, skatteverketAmount: amount });
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      rotRutPaidOutAt: input.paidOn,
      rotRutRequestedAt: invoice.rotRutRequestedAt ?? input.paidOn,
      rotRutPayoutTransactionId: transaction?.id ?? null,
      rotRutDetailsJson: JSON.stringify({ ...details, payoutAmount: amount }),
      status,
      ...(status === "PAID" ? {} : { paidAt: null }),
      ...(shortfall > 0 && input.newDueDate ? { dueDate: input.newDueDate } : {})
    }
  });

  return { transaction, amount, shortfall, status };
};

/**
 * Takes a registered payout back: the ledger entry is cancelled with a
 * reversing entry and the invoice waits for Skatteverket again.
 */
export const undoRotRutPayout = async (
  db: PrismaClient,
  input: { businessId: string; invoiceId: string; userId?: string | null }
) =>
  db.$transaction(async (tx) => {
    const invoice = await loadOne(tx, input.businessId, input.invoiceId);
    if (!invoice.rotRutPaidOutAt) throw new RotRutError("not_paid_out", 409);
    const amounts = invoiceAmounts(invoice);
    const deduction = asNumber(invoice.rotRutDeduction ?? 0);
    // With the payout gone the customer owes the invoice minus the full reduction again.
    if (amounts.paidAmount + amounts.creditedAmount > round2(amounts.grossAmount - deduction) + 0.004) {
      throw new RotRutError("customer_paid_shortfall", 409);
    }

    let reversalVerificationNumber: number | null = null;
    if (invoice.rotRutPayoutTransactionId) {
      const { reversal } = await voidTransaction(tx, {
        businessId: input.businessId,
        transactionId: invoice.rotRutPayoutTransactionId,
        userId: input.userId,
        reason: `Skatteverket payout on invoice ${invoice.invoiceNumber} undone`
      });
      reversalVerificationNumber = reversal.verificationNumber;
    }

    const details = parseRotRutDetails(invoice.rotRutDetailsJson);
    if (details) delete details.payoutAmount;
    const status = storedStatusFor({ ...amounts, skatteverketAmount: deduction });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        rotRutPaidOutAt: null,
        rotRutPayoutTransactionId: null,
        rotRutDetailsJson: details ? JSON.stringify(details) : invoice.rotRutDetailsJson,
        status,
        ...(status === "PAID" ? { paidAt: invoice.paidAt ?? lastPaymentDate(invoice) } : { paidAt: null })
      }
    });
    return { reversalVerificationNumber };
  });
