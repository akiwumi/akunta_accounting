/**
 * Quotes (offerter). A quote is not a bookkeeping record: it posts nothing to
 * the ledger and may be edited or deleted until it has been turned into an
 * invoice.
 */

import { type PrismaClient } from "@prisma/client";

import { asNumber } from "@/lib/accounting/math";
import { createInvoiceRecord } from "@/lib/invoices/create";
import { pdfFileName } from "@/lib/invoices/load";
import { buildQuotePdf } from "@/lib/invoices/pdf";
import { type InvoiceVatMode } from "@/lib/invoices/types";

export const QuoteStatuses = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
  INVOICED: "INVOICED"
} as const;

export type QuoteStatus = (typeof QuoteStatuses)[keyof typeof QuoteStatuses];

export class QuoteError extends Error {
  constructor(
    message: string,
    public readonly status: number = 409,
    public readonly code: "not_found" | "already_invoiced" | "declined" = "already_invoiced"
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

/** A draft or sent quote past its "valid until" date counts as expired, without anything being stored. */
export const effectiveQuoteStatus = (
  quote: { status: string; validUntil: Date | null },
  today: Date
): QuoteStatus => {
  const stored = (Object.values(QuoteStatuses) as string[]).includes(quote.status)
    ? (quote.status as QuoteStatus)
    : QuoteStatuses.DRAFT;
  if ((stored === "DRAFT" || stored === "SENT") && quote.validUntil && quote.validUntil < today) return "EXPIRED";
  return stored;
};

export const quoteStatusLabel = (status: QuoteStatus, locale: "sv" | "en") => {
  const labels: Record<QuoteStatus, [string, string]> = {
    DRAFT: ["Utkast", "Draft"],
    SENT: ["Skickad", "Sent"],
    ACCEPTED: ["Accepterad", "Accepted"],
    DECLINED: ["Avböjd", "Declined"],
    EXPIRED: ["Utgången", "Expired"],
    INVOICED: ["Fakturerad", "Invoiced"]
  };
  return labels[status][locale === "sv" ? 0 : 1];
};

export const canEditQuote = (status: string) => status !== QuoteStatuses.INVOICED;

/**
 * "Turn into invoice": creates an invoice with the quote's customer and
 * lines, links it (Quote.invoiceId) and marks the quote INVOICED, all in one
 * database transaction. The quote is claimed first, so it cannot be turned
 * into an invoice twice, even by two requests at the same moment.
 */
export const convertQuoteToInvoice = async (
  db: PrismaClient,
  input: { businessId: string; quoteId: string; today: Date }
) =>
  db.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId },
      include: { items: { orderBy: { sortOrder: "asc" } } }
    });
    if (!quote) throw new QuoteError("Quote not found.", 404, "not_found");
    if (quote.status === QuoteStatuses.DECLINED) {
      throw new QuoteError("A declined quote cannot be invoiced.", 409, "declined");
    }

    const claimed = await tx.quote.updateMany({
      where: { id: quote.id, businessId: input.businessId, invoiceId: null, status: { not: QuoteStatuses.INVOICED } },
      data: { status: QuoteStatuses.INVOICED, acceptedAt: quote.acceptedAt ?? new Date() }
    });
    if (claimed.count !== 1) throw new QuoteError("This quote has already been turned into an invoice.");

    const invoice = await createInvoiceRecord(tx, {
      businessId: input.businessId,
      customerId: quote.customerId,
      customer: { name: quote.customerName, email: quote.customerEmail, address: quote.customerAddress },
      items: quote.items.map((item) => ({
        description: item.description,
        quantity: asNumber(item.quantity),
        unitPrice: asNumber(item.unitPrice),
        vatMode: item.vatMode as InvoiceVatMode,
        vatRate: asNumber(item.vatRate)
      })),
      issueDate: input.today,
      currency: quote.currency,
      projectName: quote.projectName,
      description: quote.description,
      notes: quote.notes,
      emailTo: quote.customerEmail
    });

    await tx.quote.update({ where: { id: quote.id }, data: { invoiceId: invoice.id } });
    return invoice;
  });

export const loadQuoteForOutput = async (db: PrismaClient, input: { businessId: string; quoteId: string }) => {
  const quote = await db.quote.findFirst({
    where: { id: input.quoteId, businessId: input.businessId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      invoice: { select: { id: true, invoiceNumber: true } },
      business: {
        select: {
          name: true,
          locale: true,
          vatNumber: true,
          fSkattRegistered: true,
          invoiceSenderName: true,
          invoiceSenderAddress: true,
          invoiceSenderOrgNumber: true,
          invoiceSenderEmail: true,
          invoiceSenderPhone: true,
          invoiceSenderWebsite: true,
          invoiceEmailFrom: true
        }
      }
    }
  });
  if (!quote) return null;

  return {
    id: quote.id,
    customerId: quote.customerId,
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerAddress: quote.customerAddress,
    projectName: quote.projectName,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    description: quote.description,
    notes: quote.notes,
    currency: quote.currency,
    status: quote.status,
    sentAt: quote.sentAt,
    acceptedAt: quote.acceptedAt,
    invoice: quote.invoice,
    subtotalAmount: asNumber(quote.subtotalAmount),
    vatAmount: asNumber(quote.vatAmount),
    grossAmount: asNumber(quote.grossAmount),
    locale: (quote.business.locale === "sv" ? "sv" : "en") as "sv" | "en",
    emailFrom: quote.business.invoiceEmailFrom,
    sender: {
      name: quote.business.invoiceSenderName ?? quote.business.name,
      address: quote.business.invoiceSenderAddress,
      registration: quote.business.invoiceSenderOrgNumber,
      email: quote.business.invoiceSenderEmail,
      phone: quote.business.invoiceSenderPhone,
      website: quote.business.invoiceSenderWebsite
    },
    vatNumber: quote.business.vatNumber,
    fSkattRegistered: quote.business.fSkattRegistered,
    items: quote.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: asNumber(item.quantity),
      unitPrice: asNumber(item.unitPrice),
      vatMode: item.vatMode,
      vatRate: asNumber(item.vatRate),
      netAmount: asNumber(item.netAmount),
      vatAmount: asNumber(item.vatAmount),
      totalAmount: asNumber(item.totalAmount)
    }))
  };
};

export type LoadedQuote = NonNullable<Awaited<ReturnType<typeof loadQuoteForOutput>>>;

export const quotePdfFileName = (quote: LoadedQuote) =>
  pdfFileName(quote.locale === "sv" ? "offert" : "quote", quote.quoteNumber);

export const renderQuotePdf = (quote: LoadedQuote): Buffer =>
  buildQuotePdf({
    quoteNumber: quote.quoteNumber,
    projectName: quote.projectName,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    currency: quote.currency,
    sender: quote.sender,
    customer: { name: quote.customerName, address: quote.customerAddress, email: quote.customerEmail },
    items: quote.items,
    subtotalAmount: quote.subtotalAmount,
    vatAmount: quote.vatAmount,
    grossAmount: quote.grossAmount,
    description: quote.description,
    notes: quote.notes,
    locale: quote.locale,
    vatNumber: quote.vatNumber,
    fSkattRegistered: quote.fSkattRegistered
  });

export const defaultQuoteEmail = (quote: LoadedQuote, formattedTotal: string) => {
  const sv = quote.locale === "sv";
  const senderName = quote.sender.name;
  const valid = quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null;
  const subject = sv
    ? `Offert ${quote.quoteNumber} från ${senderName}`
    : `Quote ${quote.quoteNumber} from ${senderName}`;
  const body = sv
    ? [
        `Hej ${quote.customerName},`,
        `Tack för din förfrågan. Här kommer offert ${quote.quoteNumber}, bifogad som PDF.`,
        [`Summa: ${formattedTotal}`, valid ? `Giltig till och med: ${valid}` : ""].filter(Boolean).join("\n"),
        "Svara gärna på det här meddelandet om du vill tacka ja eller har frågor.",
        `Vänliga hälsningar\n${senderName}`
      ]
    : [
        `Hello ${quote.customerName},`,
        `Thank you for your enquiry. Please find quote ${quote.quoteNumber} attached as a PDF.`,
        [`Total: ${formattedTotal}`, valid ? `Valid until: ${valid}` : ""].filter(Boolean).join("\n"),
        "Just reply to this message to accept the quote or if you have any questions.",
        `Kind regards\n${senderName}`
      ];
  return { subject, body: body.join("\n\n") };
};
