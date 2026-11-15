/**
 * The one place an Invoice row is created. Used by the invoice form, by
 * "Turn into invoice" on a quote and by the recurring invoice job, so the
 * number series, OCR reference and default due date always follow the same
 * rules.
 *
 * Creating an invoice posts nothing to the ledger (kontantmetoden: the
 * payment is what gets booked).
 *
 * With rotRut set, the invoice carries a preliminary tax reduction: the
 * customer owes the total minus the reduction, and the reduction is later
 * requested from Skatteverket (lib/invoices/rotrut.ts). Throws RotRutError
 * when the business or the details do not allow it.
 */

import { type Prisma } from "@prisma/client";

import { computeInvoiceItem, computeInvoiceTotals } from "@/lib/invoices/calculations";
import { addDays } from "@/lib/invoices/dates";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { ocrReferenceForInvoice } from "@/lib/invoices/ocr";
import {
  assertRotRutLines,
  computeRotRut,
  isRotRutType,
  type RotRutBuyerInput,
  type RotRutDetails,
  RotRutError,
  type RotRutLine,
  type RotRutType,
  validateRotRutBuyer
} from "@/lib/invoices/rotrut";
import { type InvoiceItemInput } from "@/lib/invoices/types";

type Db = Prisma.TransactionClient;

export class InvoiceInputError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "InvoiceInputError";
  }
}

export type CreateInvoiceInput = {
  businessId: string;
  customerId?: string | null;
  customer: {
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
  };
  items: InvoiceItemInput[];
  issueDate: Date;
  /** Left out: issue date plus paymentTermsDays, or the business default. */
  dueDate?: Date | null;
  paymentTermsDays?: number | null;
  currency?: string;
  /** Left out: the next number in the business series. */
  invoiceNumber?: string | null;
  projectName?: string | null;
  description?: string | null;
  notes?: string | null;
  paymentMethod?: string | null;
  paymentDetails?: string | null;
  sender?: {
    name?: string | null;
    address?: string | null;
    registration?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
  };
  logoDataUrl?: string | null;
  signatureDataUrl?: string | null;
  emailTo?: string | null;
  recurringInvoiceId?: string | null;
  /** The customer gets ROT or RUT. The lines say which of them are labour. */
  rotRut?: ({ type: RotRutType } & RotRutBuyerInput) | null;
};

const clean = (value: string | null | undefined) => value?.trim() || null;

export const createInvoiceRecord = async (db: Db, input: CreateInvoiceInput) => {
  const computed = computeInvoiceTotals(input.items);
  if (computed.items.length === 0 || computed.grossAmount <= 0) {
    throw new InvoiceInputError("Invoice must include at least one valid line item.");
  }

  const customNumber = clean(input.invoiceNumber);

  // Taking the number by incrementing first locks the business row, so two
  // invoices created at the same moment can never get the same number.
  const business = customNumber
    ? await db.business.findUnique({ where: { id: input.businessId } })
    : await db.business.update({
        where: { id: input.businessId },
        data: { nextInvoiceSequence: { increment: 1 } }
      });
  if (!business) throw new InvoiceInputError("Business not found.", 404);

  const sequence = customNumber ? business.nextInvoiceSequence : business.nextInvoiceSequence - 1;
  const invoiceNumber =
    customNumber ??
    formatInvoiceNumber({ pattern: business.invoiceNumberPattern, sequence, issueDate: input.issueDate });

  const duplicate = await db.invoice.findFirst({
    where: { businessId: input.businessId, invoiceNumber },
    select: { id: true }
  });
  if (duplicate) throw new InvoiceInputError("Invoice number already exists.", 409);

  const usedReferences = new Set(
    (
      await db.invoice.findMany({
        where: { businessId: input.businessId, ocrReference: { not: null } },
        select: { ocrReference: true },
        orderBy: { createdAt: "desc" },
        take: 2000
      })
    ).map((row) => row.ocrReference as string)
  );
  const ocrReference = ocrReferenceForInvoice({
    invoiceNumber,
    fallbackSequence: sequence,
    isTaken: (candidate) => usedReferences.has(candidate)
  });

  // ROT/RUT: the reduction, the buyer's details and what each line counts as.
  const currency = input.currency ?? business.baseCurrency ?? "SEK";
  let rotRut: { type: RotRutType; deduction: number; details: RotRutDetails } | null = null;
  const keptInputs = input.items.filter((item) => {
    const line = computeInvoiceItem(item);
    return line.description.length > 0 && line.quantity > 0;
  });
  if (input.rotRut) {
    if (!isRotRutType(input.rotRut.type)) throw new RotRutError("type");
    if (!business.fSkattRegistered) throw new RotRutError("no_f_skatt", 409);
    if (business.bookkeepingMethod === "fakturametoden") throw new RotRutError("accrual", 409);
    if (currency !== "SEK") throw new RotRutError("currency");
    const lines: RotRutLine[] = keptInputs.map((item, index) => ({
      totalAmount: computed.items[index].totalAmount,
      labour: Boolean(item.rotRutLabour),
      workType: item.rotRutWorkType?.trim() || null,
      hours: item.rotRutHours ?? null
    }));
    assertRotRutLines(input.rotRut.type, lines);
    const buyer = validateRotRutBuyer(input.rotRut.type, input.rotRut, {
      year: input.issueDate.getUTCFullYear(),
      performerId: business.personnummer
    });
    const reduction = computeRotRut({ type: input.rotRut.type, date: input.issueDate, lines });
    if (reduction.deduction <= 0) throw new RotRutError("no_labour");
    rotRut = { type: input.rotRut.type, deduction: reduction.deduction, details: { ...buyer, rate: reduction.rate } };
  }

  const termsDays = Math.max(0, Math.trunc(input.paymentTermsDays ?? business.defaultPaymentTermsDays ?? 30));
  const dueDate = input.dueDate ?? addDays(input.issueDate, termsDays);
  const sender = input.sender ?? {};

  return db.invoice.create({
    data: {
      businessId: input.businessId,
      customerId: input.customerId ?? null,
      invoiceNumber,
      ocrReference,
      customerName: input.customer.name.trim(),
      customerEmail: clean(input.customer.email),
      customerPhone: clean(input.customer.phone),
      customerWebsite: clean(input.customer.website),
      customerAddress: clean(input.customer.address),
      senderName: clean(sender.name) ?? business.invoiceSenderName ?? business.name,
      senderAddress: clean(sender.address) ?? business.invoiceSenderAddress ?? null,
      senderOrgNumber: clean(sender.registration) ?? business.invoiceSenderOrgNumber ?? null,
      senderEmail: clean(sender.email) ?? business.invoiceSenderEmail ?? null,
      senderPhone: clean(sender.phone) ?? business.invoiceSenderPhone ?? null,
      senderWebsite: clean(sender.website) ?? business.invoiceSenderWebsite ?? null,
      projectName: clean(input.projectName),
      description: clean(input.description),
      notes: clean(input.notes),
      paymentMethod: clean(input.paymentMethod),
      paymentDetails: clean(input.paymentDetails),
      logoDataUrl: clean(input.logoDataUrl) ?? business.invoiceDefaultLogo ?? null,
      signatureDataUrl: clean(input.signatureDataUrl) ?? business.invoiceDefaultSignature ?? null,
      subtotalAmount: computed.subtotal,
      vatAmount: computed.vatAmount,
      grossAmount: computed.grossAmount,
      vatRate: computed.vatRate,
      issueDate: input.issueDate,
      dueDate,
      currency,
      status: "UNPAID",
      emailTo: clean(input.emailTo),
      recurringInvoiceId: input.recurringInvoiceId ?? null,
      rotRutType: rotRut?.type ?? null,
      rotRutDeduction: rotRut?.deduction ?? null,
      rotRutDetailsJson: rotRut ? JSON.stringify(rotRut.details) : null,
      items: {
        create: computed.items.map((item, index) => ({
          sortOrder: index,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatMode: item.vatMode,
          vatRate: item.vatRate,
          netAmount: item.netAmount,
          vatAmount: item.vatAmount,
          totalAmount: item.totalAmount,
          ...(rotRut
            ? {
                rotRutLabour: Boolean(keptInputs[index].rotRutLabour),
                rotRutWorkType: keptInputs[index].rotRutWorkType?.trim() || null,
                rotRutHours: keptInputs[index].rotRutLabour ? (keptInputs[index].rotRutHours ?? null) : null
              }
            : {})
        }))
      }
    },
    include: { items: { orderBy: { sortOrder: "asc" } } }
  });
};

export const joinAddress = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
