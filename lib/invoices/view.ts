/**
 * Turns invoice rows from the database into what the list and the action
 * buttons need: balance, status, label. Server side only.
 */

import { type Prisma } from "@prisma/client";

import { invoiceAmounts, invoiceBalanceInclude } from "@/lib/invoices/balance";
import { isRotRutType, rotRutStage } from "@/lib/invoices/rotrut";
import { computeInvoiceStatus, invoiceStatusLabel, invoiceStatusTone } from "@/lib/invoices/status";

export type InvoiceWithBalance = Prisma.InvoiceGetPayload<{ include: typeof invoiceBalanceInclude }>;

export const toInvoiceRow = (invoice: InvoiceWithBalance, today: Date, locale: "sv" | "en", accrual = false) => {
  const amounts = invoiceAmounts(invoice);
  const status = computeInvoiceStatus({
    status: invoice.status,
    ...amounts,
    dueDate: invoice.dueDate,
    sentAt: invoice.sentAt,
    today
  });
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerEmail: invoice.emailTo ?? invoice.customerEmail,
    currency: invoice.currency,
    grossAmount: amounts.grossAmount,
    paidAmount: amounts.paidAmount,
    creditedAmount: amounts.creditedAmount,
    remaining: status.remaining,
    statusKind: status.kind,
    overdue: status.overdue,
    statusLabel: invoiceStatusLabel(status, locale),
    statusTone: invoiceStatusTone(status),
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    reminderCount: invoice.reminderCount,
    pendingRefund: amounts.pendingRefund,
    accrual,
    /** ROT/RUT: Skatteverket's part and where the request stands. Null on other invoices. */
    rotRut: isRotRutType(invoice.rotRutType)
      ? {
          type: invoice.rotRutType,
          /** The part the customer does not owe. */
          skatteverketAmount: amounts.skatteverketAmount,
          /** What Skatteverket has paid out so far. */
          received: amounts.skatteverketReceived,
          stage: rotRutStage({
            rotRutType: invoice.rotRutType,
            status: invoice.status,
            creditedAmount: amounts.creditedAmount,
            remaining: amounts.remainingAmount,
            rotRutRequestedAt: invoice.rotRutRequestedAt,
            rotRutPaidOutAt: invoice.rotRutPaidOutAt
          })
        }
      : null
  };
};

/** What is owed and what is late, across a set of invoices. */
export const summarizeOpenInvoices = (rows: { remaining: number; overdue: boolean }[]) => ({
  outstanding: Math.round(rows.reduce((sum, row) => sum + row.remaining, 0) * 100) / 100,
  overdue: Math.round(rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.remaining, 0) * 100) / 100,
  overdueCount: rows.filter((row) => row.overdue && row.remaining > 0).length
});
