import { asNumber } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { creditNoteRefunds, invoiceAmounts } from "@/lib/invoices/balance";
import { buildInvoicePdf } from "@/lib/invoices/pdf";
import {
  buildRotRutCase,
  formatPersonnummer,
  isRotRutType,
  parseRotRutDetails,
  rotRutDeadline,
  rotRutLineSums,
  rotRutPropertyText,
  rotRutStage,
  rotRutWorkTypeLabel
} from "@/lib/invoices/rotrut";

export const loadInvoiceForOutput = async (input: { businessId: string; invoiceId: string }) => {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: input.invoiceId,
      businessId: input.businessId
    },
    include: {
      business: {
        select: {
          name: true,
          bookkeepingMethod: true,
          locale: true,
          vatNumber: true,
          fSkattRegistered: true,
          personnummer: true,
          bankgiro: true,
          plusgiro: true,
          iban: true,
          bic: true,
          swishNumber: true,
          invoiceSenderName: true,
          invoiceSenderAddress: true,
          invoiceSenderOrgNumber: true,
          invoiceSenderEmail: true,
          invoiceSenderPhone: true,
          invoiceSenderWebsite: true,
          invoiceEmailFrom: true
        }
      },
      items: {
        orderBy: { sortOrder: "asc" }
      },
      payments: {
        orderBy: { paymentDate: "asc" },
        include: { transaction: { select: { id: true, voidedAt: true, verificationNumber: true } } }
      },
      creditNotes: {
        orderBy: { issueDate: "asc" },
        include: { transaction: { select: { id: true, voidedAt: true, verificationNumber: true } } }
      },
      paidTransaction: {
        select: { id: true }
      }
    }
  });

  if (!invoice) return null;

  const amounts = invoiceAmounts(invoice);
  const payments = invoice.payments.map((payment) => ({
    id: payment.id,
    paymentDate: payment.paymentDate,
    amount: asNumber(payment.amount),
    reference: payment.reference,
    notes: payment.notes,
    transactionId: payment.transactionId,
    verificationNumber: payment.transaction?.verificationNumber ?? null,
    cancelled: Boolean(payment.transaction?.voidedAt)
  }));
  const refunds = new Map(creditNoteRefunds(invoice).map((note) => [note.id, note]));
  const creditNotes = invoice.creditNotes.map((note) => ({
    id: note.id,
    creditNoteNumber: note.creditNoteNumber,
    issueDate: note.issueDate,
    amount: asNumber(note.amount),
    reason: note.reason,
    transactionId: note.transactionId,
    verificationNumber: note.transaction?.voidedAt ? null : (note.transaction?.verificationNumber ?? null),
    /** The part of the credit that pays back money received, and what of it is not yet booked as paid out. */
    refund: refunds.get(note.id)?.refund ?? 0,
    pendingRefund: refunds.get(note.id)?.pendingRefund ?? 0
  }));

  // ROT/RUT: the reduction, where the request to Skatteverket stands, and the values of the request.
  const rotRutDetails = parseRotRutDetails(invoice.rotRutDetailsJson);
  let rotRut = null;
  if (isRotRutType(invoice.rotRutType) && rotRutDetails) {
    const lines = invoice.items.map((item) => ({
      totalAmount: asNumber(item.totalAmount),
      labour: item.rotRutLabour,
      workType: item.rotRutWorkType,
      hours: item.rotRutHours === null ? null : asNumber(item.rotRutHours)
    }));
    const deduction = asNumber(invoice.rotRutDeduction ?? 0);
    const activePayments = payments.filter((payment) => !payment.cancelled);
    // The request carries one payment date: the day the customer's last payment arrived.
    const paymentDate = activePayments.length > 0 ? activePayments[activePayments.length - 1].paymentDate : null;
    const payoutTransaction = invoice.rotRutPayoutTransactionId
      ? await prisma.transaction.findFirst({
          where: { id: invoice.rotRutPayoutTransactionId, businessId: input.businessId },
          select: { id: true, verificationNumber: true }
        })
      : null;
    rotRut = {
      type: invoice.rotRutType,
      rate: rotRutDetails.rate,
      deduction,
      ...rotRutLineSums(lines),
      /** The part the customer does not owe: the reduction, or what Skatteverket actually paid. */
      skatteverketAmount: amounts.skatteverketAmount,
      /** What Skatteverket paid. Null until the payout is registered. */
      payoutAmount: invoice.rotRutPaidOutAt ? amounts.skatteverketReceived : null,
      /** Requested but not paid by Skatteverket: owed by the customer. */
      shortfall: invoice.rotRutPaidOutAt ? Math.max(0, deduction - amounts.skatteverketReceived) : 0,
      /** The whole of the customer's part. */
      customerTotal: Math.round((amounts.grossAmount - amounts.skatteverketAmount) * 100) / 100,
      stage: rotRutStage({
        rotRutType: invoice.rotRutType,
        status: invoice.status,
        creditedAmount: amounts.creditedAmount,
        remaining: amounts.remainingAmount,
        rotRutRequestedAt: invoice.rotRutRequestedAt,
        rotRutPaidOutAt: invoice.rotRutPaidOutAt
      }),
      requestedAt: invoice.rotRutRequestedAt,
      paidOutAt: invoice.rotRutPaidOutAt,
      payoutTransactionId: payoutTransaction?.id ?? null,
      payoutVerificationNumber: payoutTransaction?.verificationNumber ?? null,
      details: rotRutDetails,
      paymentDate,
      deadline: paymentDate ? rotRutDeadline(paymentDate) : null,
      /** The values of the request to Skatteverket. Null until the customer has paid. */
      requestCase: paymentDate
        ? buildRotRutCase({
            type: invoice.rotRutType,
            invoiceNumber: invoice.invoiceNumber,
            details: rotRutDetails,
            deduction,
            paymentDate,
            lines
          })
        : null,
      lines
    };
  }

  return {
    id: invoice.id,
    customerId: invoice.customerId,
    invoiceNumber: invoice.invoiceNumber,
    ocrReference: invoice.ocrReference,
    projectName: invoice.projectName,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    description: invoice.description,
    notes: invoice.notes,
    paymentMethod: invoice.paymentMethod,
    paymentDetails: invoice.paymentDetails,
    currency: invoice.currency,
    status: invoice.status,
    sentAt: invoice.sentAt,
    paidAt: invoice.paidAt,
    emailTo: invoice.emailTo,
    reminderCount: invoice.reminderCount,
    lastReminderAt: invoice.lastReminderAt,
    recurringInvoiceId: invoice.recurringInvoiceId,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    customerWebsite: invoice.customerWebsite,
    customerAddress: invoice.customerAddress,
    senderName: invoice.senderName ?? invoice.business.invoiceSenderName ?? invoice.business.name,
    senderAddress: invoice.senderAddress ?? invoice.business.invoiceSenderAddress ?? null,
    senderOrgNumber: invoice.senderOrgNumber ?? invoice.business.invoiceSenderOrgNumber ?? null,
    senderEmail: invoice.senderEmail ?? invoice.business.invoiceSenderEmail ?? null,
    senderPhone: invoice.senderPhone ?? invoice.business.invoiceSenderPhone ?? null,
    senderWebsite: invoice.senderWebsite ?? invoice.business.invoiceSenderWebsite ?? null,
    logoDataUrl: invoice.logoDataUrl,
    signatureDataUrl: invoice.signatureDataUrl,
    subtotalAmount: asNumber(invoice.subtotalAmount),
    vatAmount: asNumber(invoice.vatAmount),
    grossAmount: amounts.grossAmount,
    vatRate: asNumber(invoice.vatRate),
    paidAmount: amounts.paidAmount,
    creditedAmount: amounts.creditedAmount,
    remainingAmount: amounts.remainingAmount,
    pendingRefund: amounts.pendingRefund,
    rotRut,
    /** The business's own personnummer or organisation number, for the request to Skatteverket. */
    performerId: invoice.business.personnummer ?? invoice.business.invoiceSenderOrgNumber ?? null,
    accrual: invoice.business.bookkeepingMethod === "fakturametoden",
    payments,
    creditNotes,
    paidTransactionId: invoice.paidTransaction?.id ?? null,
    businessInvoiceEmailFrom: invoice.business.invoiceEmailFrom,
    businessLocale: (invoice.business.locale === "sv" ? "sv" : "en") as "sv" | "en",
    businessVatNumber: invoice.business.vatNumber,
    businessFSkatt: invoice.business.fSkattRegistered,
    paymentAccounts: {
      bankgiro: invoice.business.bankgiro,
      plusgiro: invoice.business.plusgiro,
      iban: invoice.business.iban,
      bic: invoice.business.bic,
      swishNumber: invoice.business.swishNumber
    },
    items: invoice.items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      description: item.description,
      quantity: asNumber(item.quantity),
      unitPrice: asNumber(item.unitPrice),
      vatMode: item.vatMode,
      vatRate: asNumber(item.vatRate),
      netAmount: asNumber(item.netAmount),
      vatAmount: asNumber(item.vatAmount),
      totalAmount: asNumber(item.totalAmount),
      rotRutLabour: item.rotRutLabour,
      rotRutWorkType: item.rotRutWorkType,
      rotRutHours: item.rotRutHours === null ? null : asNumber(item.rotRutHours)
    }))
  };
};

export type LoadedInvoice = NonNullable<Awaited<ReturnType<typeof loadInvoiceForOutput>>>;

const sanitizeFileNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";

export const invoicePdfFileName = (invoice: { invoiceNumber: string; businessLocale: "sv" | "en" }) =>
  `${invoice.businessLocale === "sv" ? "faktura" : "invoice"}-${sanitizeFileNamePart(invoice.invoiceNumber)}.pdf`;

export const pdfFileName = (prefix: string, number: string) => `${prefix}-${sanitizeFileNamePart(number)}.pdf`;

/** The PDF for a loaded invoice: one definition, used for download, email and reminders. */
export const renderInvoicePdf = (invoice: LoadedInvoice): Buffer =>
  buildInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    projectName: invoice.projectName,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    sender: {
      name: invoice.senderName,
      address: invoice.senderAddress,
      registration: invoice.senderOrgNumber,
      email: invoice.senderEmail,
      phone: invoice.senderPhone,
      website: invoice.senderWebsite
    },
    customer: {
      name: invoice.customerName,
      address: invoice.customerAddress,
      email: invoice.customerEmail,
      phone: invoice.customerPhone,
      website: invoice.customerWebsite
    },
    items: invoice.items,
    subtotalAmount: invoice.subtotalAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
    notes: invoice.notes,
    paymentMethod: invoice.paymentMethod,
    paymentDetails: invoice.paymentDetails,
    locale: invoice.businessLocale,
    ocrReference: invoice.ocrReference,
    paymentAccounts: invoice.paymentAccounts,
    paidAmount: invoice.paidAmount,
    creditedAmount: invoice.creditedAmount,
    vatNumber: invoice.businessVatNumber,
    fSkattRegistered: invoice.businessFSkatt,
    rotRut: invoice.rotRut
      ? {
          type: invoice.rotRut.type,
          rate: invoice.rotRut.rate,
          labourAmount: invoice.rotRut.labourAmount,
          materialAmount: invoice.rotRut.materialAmount,
          otherAmount: invoice.rotRut.otherAmount,
          deduction: invoice.rotRut.deduction,
          approvedAmount: invoice.rotRut.payoutAmount,
          personnummer: formatPersonnummer(invoice.rotRut.details.personnummer),
          property: rotRutPropertyText(invoice.rotRut.details, invoice.businessLocale),
          works: workSummary(invoice.rotRut.lines, invoice.businessLocale)
        }
      : undefined
  });

/** "Bygg, 16 timmar" per type of work on the labour lines. */
const workSummary = (
  lines: { labour: boolean; workType: string | null; hours: number | null }[],
  locale: "sv" | "en"
) => {
  const hours = new Map<string, number>();
  for (const line of lines) {
    if (!line.labour || !line.workType) continue;
    hours.set(line.workType, (hours.get(line.workType) ?? 0) + (line.hours ?? 0));
  }
  return [...hours.entries()].map(([code, total]) => ({ label: rotRutWorkTypeLabel(code, locale), hours: total }));
};
