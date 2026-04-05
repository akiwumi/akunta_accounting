import { NextResponse } from "next/server";
import { z } from "zod";

import { asNumber } from "@/lib/accounting/math";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { InvoiceVatModes } from "@/lib/invoices/types";

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  vatMode: z.enum([InvoiceVatModes.NO_VAT, InvoiceVatModes.INCLUSIVE, InvoiceVatModes.EXCLUSIVE]),
  vatRate: z.number().min(0).max(1).default(0)
});

const customerSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(120).optional(),
  addressLine1: z.string().trim().max(180).optional(),
  addressLine2: z.string().trim().max(180).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional()
});

const senderSchema = z.object({
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
  registration: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(120).optional()
});

const createInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(60).optional(),
  projectName: z.string().trim().max(180).optional(),
  customer: customerSchema,
  sender: senderSchema.optional(),
  description: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(2000).optional(),
  paymentMethod: z.string().trim().max(120).optional(),
  paymentDetails: z.string().trim().max(1000).optional(),
  issueDate: z.string().min(10),
  dueDate: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
  currency: z.enum(["SEK", "EUR", "GBP"]).default("SEK")
}).extend({
  emailTo: z.string().trim().email().max(120).optional().or(z.literal("")),
  logoDataUrl: z.string().trim().max(1_500_000).optional(),
  signatureDataUrl: z.string().trim().max(1_500_000).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const business = await ensureBusiness();
  const payload = createInvoiceSchema.parse(await request.json());

  const issueDate = new Date(`${payload.issueDate}T00:00:00.000Z`);
  if (Number.isNaN(issueDate.valueOf())) {
    return NextResponse.json({ error: "Invalid issue date." }, { status: 400 });
  }

  const dueDate = payload.dueDate ? new Date(`${payload.dueDate}T00:00:00.000Z`) : null;
  if (dueDate && Number.isNaN(dueDate.valueOf())) {
    return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
  }

  const computed = computeInvoiceTotals(payload.items);
  if (computed.items.length === 0 || computed.grossAmount <= 0) {
    return NextResponse.json({ error: "Invoice must include at least one valid line item." }, { status: 400 });
  }

  const customerAddress = [
    payload.customer.addressLine1?.trim(),
    payload.customer.addressLine2?.trim(),
    payload.customer.postalCode?.trim(),
    payload.customer.city?.trim(),
    payload.customer.country?.trim()
  ]
    .filter(Boolean)
    .join(", ");

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const freshBusiness = await tx.business.findUnique({
        where: { id: business.id },
        select: {
          id: true,
          name: true,
          invoiceNumberPattern: true,
          nextInvoiceSequence: true,
          invoiceSenderName: true,
          invoiceSenderAddress: true,
          invoiceSenderOrgNumber: true,
          invoiceSenderEmail: true,
          invoiceSenderPhone: true,
          invoiceSenderWebsite: true,
          invoiceDefaultLogo: true,
          invoiceDefaultSignature: true
        }
      });

      if (!freshBusiness) {
        throw new Error("Business not found.");
      }

      const normalizedEmail = payload.customer.email?.trim() || null;
      const customerRecord = payload.customer.id
        ? await tx.customer.findFirst({
            where: {
              id: payload.customer.id,
              businessId: business.id
            },
            select: { id: true }
          })
        : normalizedEmail
          ? await tx.customer.findFirst({
              where: {
                businessId: business.id,
                email: normalizedEmail
              },
              select: { id: true }
            })
          : await tx.customer.findFirst({
              where: {
                businessId: business.id,
                name: payload.customer.name.trim()
              },
              select: { id: true }
            });

      const customerData = {
        name: payload.customer.name.trim(),
        email: normalizedEmail,
        phone: payload.customer.phone?.trim() || null,
        website: payload.customer.website?.trim() || null,
        addressLine1: payload.customer.addressLine1?.trim() || null,
        addressLine2: payload.customer.addressLine2?.trim() || null,
        city: payload.customer.city?.trim() || null,
        postalCode: payload.customer.postalCode?.trim() || null,
        country: payload.customer.country?.trim() || null
      };

      const customer = customerRecord
        ? await tx.customer.update({
            where: { id: customerRecord.id },
            data: customerData,
            select: { id: true }
          })
        : await tx.customer.create({
            data: {
              businessId: business.id,
              ...customerData
            },
            select: { id: true }
          });

      const customNumber = payload.invoiceNumber?.trim();
      const invoiceNumber =
        customNumber && customNumber.length > 0
          ? customNumber
          : formatInvoiceNumber({
              pattern: freshBusiness.invoiceNumberPattern,
              sequence: freshBusiness.nextInvoiceSequence,
              issueDate
            });

      const sender = payload.sender ?? {};
      const created = await tx.invoice.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          invoiceNumber,
          customerName: payload.customer.name.trim(),
          customerEmail: normalizedEmail,
          customerPhone: payload.customer.phone?.trim() || null,
          customerWebsite: payload.customer.website?.trim() || null,
          customerAddress: customerAddress || null,
          senderName: sender.name?.trim() || freshBusiness.invoiceSenderName || freshBusiness.name,
          senderAddress: sender.address?.trim() || freshBusiness.invoiceSenderAddress || null,
          senderOrgNumber: sender.registration?.trim() || freshBusiness.invoiceSenderOrgNumber || null,
          senderEmail: sender.email?.trim() || freshBusiness.invoiceSenderEmail || null,
          senderPhone: sender.phone?.trim() || freshBusiness.invoiceSenderPhone || null,
          senderWebsite: sender.website?.trim() || freshBusiness.invoiceSenderWebsite || null,
          projectName: payload.projectName?.trim() || null,
          description: payload.description?.trim() || null,
          notes: payload.notes?.trim() || null,
          paymentMethod: payload.paymentMethod?.trim() || null,
          paymentDetails: payload.paymentDetails?.trim() || null,
          logoDataUrl: payload.logoDataUrl?.trim() || freshBusiness.invoiceDefaultLogo || null,
          signatureDataUrl:
            payload.signatureDataUrl?.trim() || freshBusiness.invoiceDefaultSignature || null,
          subtotalAmount: computed.subtotal,
          vatAmount: computed.vatAmount,
          grossAmount: computed.grossAmount,
          vatRate: computed.vatRate,
          issueDate,
          dueDate,
          currency: payload.currency,
          status: "UNPAID",
          emailTo: payload.emailTo?.trim() || null,
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
              totalAmount: item.totalAmount
            }))
          }
        },
        include: {
          items: true
        }
      });

      if (!customNumber) {
        await tx.business.update({
          where: { id: business.id },
          data: { nextInvoiceSequence: { increment: 1 } }
        });
      }

      return created;
    });

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalAmount: asNumber(invoice.subtotalAmount),
        vatAmount: asNumber(invoice.vatAmount),
        grossAmount: asNumber(invoice.grossAmount),
        vatRate: asNumber(invoice.vatRate),
        currency: invoice.currency,
        status: invoice.status,
        items: invoice.items.map((item) => ({
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
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Invoice number already exists." }, { status: 409 });
    }
    throw error;
  }
}
