/**
 * The one place a customer payment on an invoice is registered and booked.
 * Used by the pay and part-payment routes on the invoice and by "payment
 * received" when its reference matches an invoice, so every payment leaves an
 * InvoicePayment row, is booked on its payment date (kontantmetoden) and
 * never settles more than the customer has left to pay.
 *
 * On an invoice with ROT or RUT the customer's part is the invoice minus the
 * tax reduction; Skatteverket's part is booked when it is paid out
 * (lib/invoices/rotrut-actions.ts).
 */

import { type PrismaClient } from "@prisma/client";

import { asNumber, round2 } from "@/lib/accounting/math";
import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { invoiceAmounts, invoiceBalanceInclude, storedStatusFor } from "@/lib/invoices/balance";

export class InvoicePaymentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "not_found" | "void" | "already_paid" | "too_much",
    /** For too_much: what the customer has left to pay. */
    public readonly limit = 0
  ) {
    super(message);
    this.name = "InvoicePaymentError";
  }
}

export const registerInvoicePayment = async (
  db: PrismaClient,
  input: {
    businessId: string;
    invoiceId: string;
    amount: number;
    paymentDate: Date;
    reference?: string | null;
    notes?: string | null;
    /** Text for the ledger entry. Left out: taken from the invoice. */
    description?: string | null;
    incomeAccountCode?: string;
  }
) => {
  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, businessId: input.businessId },
    include: invoiceBalanceInclude
  });
  if (!invoice) throw new InvoicePaymentError("Invoice not found.", 404, "not_found");
  if (invoice.status === "VOID") throw new InvoicePaymentError("Invoice is voided.", 409, "void");

  const amounts = invoiceAmounts(invoice);
  const remaining = amounts.remainingAmount;
  const amount = round2(input.amount);
  if (remaining <= 0) throw new InvoicePaymentError("This invoice is already paid.", 409, "already_paid");
  if (amount > round2(remaining + 0.01)) {
    throw new InvoicePaymentError(
      `The amount ${amount} is more than what remains to be paid (${remaining}).`,
      422,
      "too_much",
      remaining
    );
  }

  const vatRate = asNumber(invoice.vatRate);
  // The first payment, for all the customer owes: the invoice is paid in one go.
  const untouched = amounts.paidAmount === 0 && amounts.creditedAmount === 0 && amounts.skatteverketReceived === 0;
  const inOneGo = untouched && Math.abs(amount - remaining) < 0.005;
  // An ordinary invoice paid in one go keeps its own net and VAT to the öre. Anything else is split at the invoice's rate.
  const exact = inOneGo && amounts.skatteverketAmount === 0;
  const rawNet = exact ? asNumber(invoice.subtotalAmount) : 0;
  const rawVat = exact ? asNumber(invoice.vatAmount) : 0;
  const netAmount = rawNet > 0 ? rawNet : vatRate > 0 ? round2(amount / (1 + vatRate)) : amount;
  const vatAmount = rawVat > 0 ? rawVat : round2(amount - netAmount);

  const transaction = await createTransaction({
    businessId: input.businessId,
    txnDate: input.paymentDate,
    description:
      input.description?.trim() ||
      (inOneGo
        ? invoice.description?.trim() ||
          invoice.projectName?.trim() ||
          `Invoice ${invoice.invoiceNumber} payment from ${invoice.customerName}`
        : `Partial payment on invoice ${invoice.invoiceNumber}`),
    direction: TransactionDirections.INCOME,
    grossAmount: amount,
    netAmount,
    vatAmount,
    vatRate,
    source: EntrySources.INVOICE_PAYMENT,
    reference: input.reference?.trim() || invoice.invoiceNumber,
    currency: invoice.currency,
    incomeAccountCode: input.incomeAccountCode ?? "3001",
    paidInvoiceId: inOneGo ? invoice.id : undefined
  });

  const payment = await db.invoicePayment.create({
    data: {
      businessId: input.businessId,
      invoiceId: invoice.id,
      transactionId: transaction.id,
      paymentDate: input.paymentDate,
      amount,
      currency: invoice.currency,
      reference: input.reference?.trim() || undefined,
      notes: input.notes?.trim() || undefined
    }
  });

  const status = storedStatusFor({ ...amounts, paidAmount: round2(amounts.paidAmount + amount) });
  await db.invoice.update({
    where: { id: invoice.id },
    data: status === "PAID" ? { status, paidAt: input.paymentDate } : { status }
  });

  return {
    invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, currency: invoice.currency },
    transaction,
    payment,
    status,
    fullyPaid: status === "PAID",
    remaining: Math.max(0, round2(remaining - amount))
  };
};

/**
 * Money received with a reference. When the reference is the number or OCR
 * reference of an invoice the customer still has something to pay on, the
 * payment is registered on that invoice, up to what is left; anything beyond
 * that is returned as `excess` and not booked. Returns null when no such
 * invoice exists (the caller then books the money as ordinary income).
 */
export const registerPaymentByReference = async (
  db: PrismaClient,
  input: {
    businessId: string;
    reference: string | null | undefined;
    amount: number;
    currency: string;
    paymentDate: Date;
    description?: string | null;
    incomeAccountCode?: string;
  }
) => {
  const reference = input.reference?.trim();
  if (!reference) return null;
  const invoice = await db.invoice.findFirst({
    where: {
      businessId: input.businessId,
      status: { in: ["UNPAID", "PARTIAL"] },
      OR: [{ invoiceNumber: reference }, { ocrReference: reference }]
    },
    include: invoiceBalanceInclude
  });
  const remaining = invoice ? invoiceAmounts(invoice).remainingAmount : 0;
  if (!invoice || remaining <= 0) return null;
  if (input.currency !== invoice.currency) {
    return { ok: false as const, reason: "currency" as const, invoiceNumber: invoice.invoiceNumber, currency: invoice.currency };
  }

  const received = round2(input.amount);
  const matched = Math.min(received, remaining);
  const result = await registerInvoicePayment(db, {
    businessId: input.businessId,
    invoiceId: invoice.id,
    amount: matched,
    paymentDate: input.paymentDate,
    description: input.description,
    incomeAccountCode: input.incomeAccountCode
  });
  return { ok: true as const, ...result, matched, excess: round2(received - matched) };
};
