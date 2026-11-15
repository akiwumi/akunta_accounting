/**
 * What has been paid and credited on an invoice, and what is still to be
 * refunded.
 *
 * A payment whose ledger entry has been cancelled (voided) no longer counts.
 * A credit note always counts: it reduces what the customer owes whether or
 * not anything was booked for it. Invoices marked PAID before payment rows
 * existed have no rows at all; they count as paid in full.
 *
 * ROT and RUT: the customer owes the invoice minus the tax reduction. The
 * reduction is Skatteverket's part (skatteverketAmount) and is never part of
 * what the customer has left to pay, so status, overdue and reminders all
 * follow the customer's part. If Skatteverket pays out less than requested,
 * its part shrinks to what it paid and the difference is the customer's.
 */

import { type Prisma, type PrismaClient } from "@prisma/client";

import { asNumber, round2 } from "@/lib/accounting/math";
import { isRotRutType, rotRutSkatteverketAmount } from "@/lib/invoices/rotrut";

export const invoiceBalanceInclude = {
  payments: { select: { amount: true, transaction: { select: { voidedAt: true } } } },
  creditNotes: {
    select: {
      id: true,
      amount: true,
      issueDate: true,
      createdAt: true,
      transaction: { select: { voidedAt: true } }
    }
  }
} satisfies Prisma.InvoiceInclude;

type PaymentRow = { amount: unknown; transaction?: { voidedAt: Date | null } | null };
type CreditRow = {
  id?: string;
  amount: unknown;
  issueDate?: Date;
  createdAt?: Date;
  transaction?: { voidedAt: Date | null } | null;
};

type BalanceInvoice = {
  status: string;
  paidAt?: Date | null;
  grossAmount: unknown;
  payments: PaymentRow[];
  creditNotes: CreditRow[];
  rotRutType?: string | null;
  rotRutDeduction?: unknown;
  rotRutPaidOutAt?: Date | null;
  rotRutDetailsJson?: string | null;
};

const paidOf = (invoice: BalanceInvoice) => {
  // Marked paid before payment rows existed. (A credit-only settlement has no paidAt.)
  if (invoice.status === "PAID" && invoice.payments.length === 0 && invoice.paidAt) {
    return round2(asNumber(invoice.grossAmount) - rotRutSkatteverketAmount(invoice).share);
  }
  return round2(
    invoice.payments.filter((row) => !row.transaction?.voidedAt).reduce((sum, row) => sum + asNumber(row.amount), 0)
  );
};

/**
 * For each credit note, the part that is a refund of money already received
 * (the part beyond what was unpaid when it was issued), and whether that
 * refund has been booked as paid out. Credit notes are taken oldest first.
 */
export const creditNoteRefunds = (invoice: BalanceInvoice) => {
  // What Skatteverket has paid out is money received, like a payment. Its part not yet paid out is simply unpaid.
  let unpaid = round2(asNumber(invoice.grossAmount) - paidOf(invoice) - rotRutSkatteverketAmount(invoice).received);
  return [...invoice.creditNotes]
    .sort(
      (a, b) =>
        (a.issueDate?.valueOf() ?? 0) - (b.issueDate?.valueOf() ?? 0) ||
        (a.createdAt?.valueOf() ?? 0) - (b.createdAt?.valueOf() ?? 0)
    )
    .map((note) => {
      const amount = asNumber(note.amount);
      const refund = Math.max(0, round2(amount - Math.max(0, unpaid)));
      unpaid = round2(unpaid - amount);
      const booked = Boolean(note.transaction) && !note.transaction?.voidedAt;
      return { id: note.id ?? null, amount, refund, pendingRefund: booked ? 0 : refund };
    });
};

export const invoiceAmounts = (invoice: BalanceInvoice) => {
  const grossAmount = asNumber(invoice.grossAmount);
  const creditedAmount = round2(invoice.creditNotes.reduce((sum, row) => sum + asNumber(row.amount), 0));
  const paidAmount = paidOf(invoice);
  const skatteverket = rotRutSkatteverketAmount(invoice);
  return {
    grossAmount,
    /** Paid by the customer. */
    paidAmount,
    creditedAmount,
    /** ROT/RUT: the part of the invoice the customer does not owe. 0 on other invoices. */
    skatteverketAmount: skatteverket.share,
    /** ROT/RUT: what Skatteverket has paid out. 0 until the payout is registered. */
    skatteverketReceived: skatteverket.received,
    /** What the customer still owes. */
    remainingAmount: Math.max(0, round2(grossAmount - skatteverket.share - paidAmount - creditedAmount)),
    /** Money received that has been credited but not yet booked as paid back. */
    pendingRefund: round2(creditNoteRefunds(invoice).reduce((sum, note) => sum + note.pendingRefund, 0))
  };
};

/** The stored status that matches the amounts. */
export const storedStatusFor = (amounts: {
  grossAmount: number;
  paidAmount: number;
  creditedAmount: number;
  skatteverketAmount?: number;
}) => {
  const remaining = round2(
    amounts.grossAmount - (amounts.skatteverketAmount ?? 0) - amounts.paidAmount - amounts.creditedAmount
  );
  if (remaining <= 0.009) return "PAID";
  if (amounts.paidAmount > 0 || amounts.creditedAmount > 0) return "PARTIAL";
  return "UNPAID";
};

/**
 * What is still to come in on an invoice, split by who owes it: the customer,
 * and for ROT/RUT Skatteverket (the reduction, requested or not, until the
 * payout is registered). A credited or voided invoice has no claim on
 * Skatteverket. After a reduced payout the difference is the customer's.
 *
 * With `asAt`, the position on that day: pass payments and credit notes up to
 * that day, and a payout or "paid" date after it counts as not yet happened.
 * Used for the year end, where income not yet received on 31 December (from
 * the customer or from Skatteverket) is booked as a receivable.
 */
export const invoiceOpenAmounts = (invoice: BalanceInvoice, asAt?: Date) => {
  const paidOut = invoice.rotRutPaidOutAt && (!asAt || invoice.rotRutPaidOutAt <= asAt) ? invoice.rotRutPaidOutAt : null;
  const amounts = invoiceAmounts({
    ...invoice,
    paidAt: invoice.paidAt && (!asAt || invoice.paidAt <= asAt) ? invoice.paidAt : null,
    rotRutPaidOutAt: paidOut
  });
  const live = invoice.status !== "VOID";
  const pendingClaim = live && isRotRutType(invoice.rotRutType) && !paidOut && amounts.creditedAmount <= 0;
  return {
    customer: live ? amounts.remainingAmount : 0,
    skatteverket: pendingClaim ? amounts.skatteverketAmount : 0
  };
};

/** The rows needed by invoiceOpenAmounts, for a query that looks at the position on `asAt`. */
export const invoiceOpenSelect = (asAt: Date) =>
  ({
    status: true,
    paidAt: true,
    grossAmount: true,
    vatAmount: true,
    rotRutType: true,
    rotRutDeduction: true,
    rotRutPaidOutAt: true,
    rotRutDetailsJson: true,
    payments: { where: { paymentDate: { lte: asAt } }, select: { amount: true, transaction: { select: { voidedAt: true } } } },
    creditNotes: { where: { issueDate: { lte: asAt } }, select: { amount: true } }
  }) satisfies Prisma.InvoiceSelect;

/**
 * VAT on what is still to come in on an invoice: under kontantmetoden it has
 * not been reported yet, and at the end of the fiscal year it must be.
 */
export const invoiceOpenVat = (invoice: BalanceInvoice & { vatAmount: unknown }, asAt?: Date) => {
  const open = invoiceOpenAmounts(invoice, asAt);
  const gross = asNumber(invoice.grossAmount);
  const total = round2(open.customer + open.skatteverket);
  return { open: total, vat: gross > 0 ? round2((total * asNumber(invoice.vatAmount)) / gross) : 0 };
};

/**
 * Kontantmetoden at the end of the fiscal year: the VAT on everything still
 * to come in on invoices issued up to `end` must be in the year's last VAT
 * return, although nothing has been paid. Counts unpaid and part-paid
 * invoices and ROT/RUT reductions Skatteverket has not yet paid out, as
 * things stand now.
 */
export const loadUnreportedInvoiceVat = async (db: PrismaClient | Prisma.TransactionClient, input: { businessId: string; end: Date }) => {
  const invoices = await db.invoice.findMany({
    where: {
      businessId: input.businessId,
      issueDate: { lte: input.end },
      vatAmount: { not: 0 },
      status: { not: "VOID" },
      OR: [{ status: { in: ["UNPAID", "PARTIAL"] } }, { rotRutType: { not: null }, rotRutPaidOutAt: null }]
    },
    include: invoiceBalanceInclude
  });
  const open = invoices.map((invoice) => invoiceOpenVat(invoice)).filter((row) => row.open > 0);
  return { count: open.length, amount: round2(open.reduce((sum, row) => sum + row.vat, 0)) };
};
