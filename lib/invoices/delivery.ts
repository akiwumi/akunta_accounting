/**
 * Sending invoices and reminders to customers. The text follows the business
 * language; the PDF is always attached.
 */

import { prisma } from "@/lib/db";
import { sendEmail, type SendEmailResult, textToHtml } from "@/lib/email/send";
import { daysBetween, isoDate, stockholmToday } from "@/lib/invoices/dates";
import { invoicePdfFileName, type LoadedInvoice, renderInvoicePdf } from "@/lib/invoices/load";
import { paymentAccountLines } from "@/lib/invoices/payment-accounts";
import { buildReminderMessage } from "@/lib/invoices/reminders";

export const formatDocumentMoney = (value: number, currency: string, locale: "sv" | "en") => {
  try {
    return new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

export const defaultInvoiceEmail = (invoice: LoadedInvoice) => {
  const sv = invoice.businessLocale === "sv";
  // ROT/RUT: the customer is only ever asked for their own part.
  const amount = formatDocumentMoney(
    invoice.remainingAmount || invoice.rotRut?.customerTotal || invoice.grossAmount,
    invoice.currency,
    invoice.businessLocale
  );
  const due = invoice.dueDate ? isoDate(invoice.dueDate) : null;
  const accounts = paymentAccountLines(invoice.paymentAccounts).map((line) => `${line.label}: ${line.value}`);
  const reference = invoice.ocrReference
    ? `${sv ? "OCR-nummer" : "OCR reference"}: ${invoice.ocrReference}`
    : `${sv ? "Ange fakturanummer" : "Please quote invoice number"}: ${invoice.invoiceNumber}`;

  const subject = sv
    ? `Faktura ${invoice.invoiceNumber} från ${invoice.senderName}`
    : `Invoice ${invoice.invoiceNumber} from ${invoice.senderName}`;
  const body = sv
    ? [
        `Hej ${invoice.customerName},`,
        `Här kommer faktura ${invoice.invoiceNumber}. Den finns bifogad som PDF.`,
        [`Att betala: ${amount}`, due ? `Betala senast: ${due}` : "", ...accounts, reference].filter(Boolean).join("\n"),
        `Tack för förtroendet.\n\nVänliga hälsningar\n${invoice.senderName}`
      ]
    : [
        `Hello ${invoice.customerName},`,
        `Please find invoice ${invoice.invoiceNumber} attached as a PDF.`,
        [`Amount to pay: ${amount}`, due ? `Pay by: ${due}` : "", ...accounts, reference].filter(Boolean).join("\n"),
        `Thank you for your business.\n\nKind regards\n${invoice.senderName}`
      ];
  return { subject, body: body.join("\n\n") };
};

export const defaultReminderEmail = (invoice: LoadedInvoice, today: Date = stockholmToday()) =>
  buildReminderMessage({
    locale: invoice.businessLocale,
    senderName: invoice.senderName,
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    amount: formatDocumentMoney(invoice.remainingAmount, invoice.currency, invoice.businessLocale),
    dueDate: invoice.dueDate ? isoDate(invoice.dueDate) : "-",
    daysOverdue: invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, today)) : 0,
    reminderNumber: invoice.reminderCount + 1,
    paymentLines: paymentAccountLines(invoice.paymentAccounts),
    ocrReference: invoice.ocrReference
  });

const send = (invoice: LoadedInvoice, to: string, subject: string, body: string) =>
  sendEmail({
    from: invoice.businessInvoiceEmailFrom,
    replyTo: invoice.senderEmail,
    to,
    subject,
    text: body,
    html: textToHtml(body),
    attachments: [
      { filename: invoicePdfFileName(invoice), content: renderInvoicePdf(invoice), contentType: "application/pdf" }
    ]
  });

/** Emails the invoice and records that it has been sent. */
export const sendInvoiceEmail = async (
  invoice: LoadedInvoice,
  input: { to: string; subject?: string | null; message?: string | null }
): Promise<SendEmailResult> => {
  const defaults = defaultInvoiceEmail(invoice);
  const result = await send(invoice, input.to, input.subject?.trim() || defaults.subject, input.message?.trim() || defaults.body);
  if (result.ok) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { sentAt: new Date(), emailTo: input.to }
    });
  }
  return result;
};

/**
 * Emails a reminder and counts it. The counter is taken before the email goes
 * out and given back if sending fails, so two runs at the same moment cannot
 * both send.
 */
export const sendInvoiceReminder = async (
  invoice: LoadedInvoice,
  input: { to: string; subject?: string | null; message?: string | null; now?: Date }
): Promise<SendEmailResult | { ok: false; reason: "already_sent"; message: string }> => {
  const now = input.now ?? new Date();
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, reminderCount: invoice.reminderCount },
    data: { reminderCount: { increment: 1 }, lastReminderAt: now }
  });
  if (claimed.count !== 1) {
    return { ok: false, reason: "already_sent", message: "A reminder for this invoice was just sent." };
  }

  const defaults = defaultReminderEmail(invoice);
  const result = await send(invoice, input.to, input.subject?.trim() || defaults.subject, input.message?.trim() || defaults.body);
  if (!result.ok) {
    await prisma.invoice.updateMany({
      where: { id: invoice.id, reminderCount: invoice.reminderCount + 1 },
      data: { reminderCount: invoice.reminderCount, lastReminderAt: invoice.lastReminderAt }
    });
  }
  return result;
};
