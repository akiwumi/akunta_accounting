/**
 * Credit notes. An issued invoice is never edited; a credit note corrects it.
 *
 * What is booked (kontantmetoden): only money that actually moves.
 * - Crediting what has not been paid books nothing. Nothing was booked when
 *   the invoice was issued, so there is nothing to reverse; the customer
 *   simply owes less.
 * - Crediting more than the unpaid balance means paying back money already
 *   received. That part is booked as a payout from the bank account on the
 *   day it is paid out, either together with the credit note or later with
 *   registerRefundPayout.
 *
 * Under fakturametoden the whole credit note is booked on its date, as before.
 *
 * ROT and RUT: before Skatteverket has paid, the invoice can only be credited
 * in full, since a part credit would not say how much of the labour (and so
 * of the tax reduction) it removes. The credit then cancels the reduction
 * too: nothing is requested from Skatteverket, and only what the customer
 * actually paid is refunded. While the request is marked as sent, crediting
 * is refused. After the payout, only the customer's part can be credited.
 */

import { type PrismaClient } from "@prisma/client";

import { asNumber, round2 } from "@/lib/accounting/math";
import { createSalesRefund } from "@/lib/accounting/posting-dispatcher";
import { EntrySources } from "@/lib/domain/enums";
import { creditNoteRefunds, invoiceAmounts, invoiceBalanceInclude, storedStatusFor } from "@/lib/invoices/balance";

export class CreditError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code:
      | "not_found"
      | "void"
      | "fully_credited"
      | "too_much"
      | "nothing_to_refund"
      | "rot_rut_requested"
      | "rot_rut_full_only",
    public readonly limit = 0
  ) {
    super(message);
    this.name = "CreditError";
  }
}

/** How a credit of `amount` splits into the part never paid and the part to pay back. */
export const planCredit = (amount: number, remaining: number) => {
  const unpaidPart = Math.min(round2(amount), Math.max(0, round2(remaining)));
  return { unpaidPart, refundPart: round2(amount - unpaidPart) };
};

const postRefund = (input: {
  businessId: string;
  date: Date;
  amount: number;
  vatRate: number;
  currency: string;
  creditNoteNumber: string;
  invoiceNumber: string;
}) => {
  return createSalesRefund({
    businessId: input.businessId,
    txnDate: input.date,
    description: `Credit note ${input.creditNoteNumber} for invoice ${input.invoiceNumber}`,
    grossAmount: input.amount,
    vatRate: input.vatRate,
    source: EntrySources.INVOICE_PAYMENT,
    reference: input.creditNoteNumber,
    currency: input.currency
  });
};

export const createCreditNote = async (
  db: PrismaClient,
  input: {
    businessId: string;
    invoiceId: string;
    amount: number;
    issueDate: Date;
    reason?: string | null;
    /** The day the refund left the bank account. Leave out when it has not been paid out yet. */
    refundPaidOn?: Date | null;
  }
) => {
  const amount = round2(input.amount);
  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, businessId: input.businessId },
    include: { ...invoiceBalanceInclude, business: { select: { bookkeepingMethod: true } } }
  });
  if (!invoice) throw new CreditError("Invoice not found.", 404, "not_found");
  if (invoice.status === "VOID") throw new CreditError("Invoice is voided.", 409, "void");

  const amounts = invoiceAmounts(invoice);
  // What Skatteverket has paid out cannot be credited here: that money is repaid to Skatteverket, not to the customer.
  const creditable = round2(amounts.grossAmount - amounts.creditedAmount - amounts.skatteverketReceived);
  if (creditable <= 0) throw new CreditError("This invoice has already been credited in full.", 409, "fully_credited");
  if (amount > round2(creditable + 0.01)) {
    throw new CreditError(`You can credit at most ${creditable} on this invoice.`, 422, "too_much", creditable);
  }
  if (invoice.rotRutType && !invoice.rotRutPaidOutAt) {
    if (invoice.rotRutRequestedAt) {
      throw new CreditError(
        "The request to Skatteverket is marked as sent. Withdraw it and undo the mark before crediting.",
        409,
        "rot_rut_requested"
      );
    }
    if (Math.abs(amount - creditable) > 0.01) {
      throw new CreditError(
        "An invoice with ROT or RUT can only be credited in full before Skatteverket has paid out.",
        422,
        "rot_rut_full_only",
        creditable
      );
    }
  }

  const accrual = invoice.business.bookkeepingMethod === "fakturametoden";
  // Everything not yet received, from the customer or from Skatteverket, is credited without a refund.
  const unpaidTotal = round2(
    amounts.grossAmount - amounts.paidAmount - amounts.creditedAmount - amounts.skatteverketReceived
  );
  const { unpaidPart, refundPart } = planCredit(amount, unpaidTotal);

  // Credit notes have their own number series.
  const count = await db.creditNote.count({ where: { businessId: input.businessId } });
  const creditNoteNumber = `CN-${input.issueDate.getUTCFullYear()}-${String(count + 1).padStart(4, "0")}`;

  const vatRate = asNumber(invoice.vatRate);
  const netAmount = vatRate > 0 ? round2(amount / (1 + vatRate)) : amount;
  const posting = { businessId: input.businessId, vatRate, currency: invoice.currency, creditNoteNumber, invoiceNumber: invoice.invoiceNumber };

  const transaction = accrual
    ? await postRefund({ ...posting, date: input.issueDate, amount })
    : refundPart > 0 && input.refundPaidOn
      ? await postRefund({ ...posting, date: input.refundPaidOn, amount: refundPart })
      : null;

  const creditNote = await db.creditNote.create({
    data: {
      businessId: input.businessId,
      invoiceId: invoice.id,
      creditNoteNumber,
      issueDate: input.issueDate,
      amount,
      vatAmount: round2(amount - netAmount),
      netAmount,
      reason: input.reason?.trim() || null,
      status: "ISSUED",
      transactionId: transaction?.id ?? null
    }
  });

  const after = { ...amounts, creditedAmount: round2(amounts.creditedAmount + amount) };
  await db.invoice.update({ where: { id: invoice.id }, data: { status: storedStatusFor(after) } });

  return {
    creditNote,
    transaction,
    unpaidPart,
    refundPart,
    /** Refund still to be paid out and registered. */
    pendingRefund: accrual || transaction ? 0 : refundPart,
    remaining: Math.max(0, round2(after.grossAmount - after.skatteverketAmount - after.paidAmount - after.creditedAmount))
  };
};

/**
 * Books the payout of refunds that were credited earlier but not yet paid
 * back, on the day the money left the account.
 */
export const registerRefundPayout = async (
  db: PrismaClient,
  input: { businessId: string; invoiceId: string; paidOn: Date }
) => {
  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, businessId: input.businessId },
    include: {
      payments: invoiceBalanceInclude.payments,
      creditNotes: { select: { ...invoiceBalanceInclude.creditNotes.select, creditNoteNumber: true } }
    }
  });
  if (!invoice) throw new CreditError("Invoice not found.", 404, "not_found");

  const pending = creditNoteRefunds(invoice).filter((note) => note.pendingRefund > 0 && note.id);
  if (pending.length === 0) {
    throw new CreditError("There is no refund waiting to be paid out on this invoice.", 409, "nothing_to_refund");
  }

  const transactions = [];
  for (const note of pending) {
    const number = invoice.creditNotes.find((row) => row.id === note.id)?.creditNoteNumber ?? "";
    const transaction = await postRefund({
      businessId: input.businessId,
      date: input.paidOn,
      amount: note.pendingRefund,
      vatRate: asNumber(invoice.vatRate),
      currency: invoice.currency,
      creditNoteNumber: number,
      invoiceNumber: invoice.invoiceNumber
    });
    await db.creditNote.update({ where: { id: note.id as string }, data: { transactionId: transaction.id } });
    transactions.push(transaction);
  }

  return { transactions, refunded: round2(pending.reduce((sum, note) => sum + note.pendingRefund, 0)) };
};
