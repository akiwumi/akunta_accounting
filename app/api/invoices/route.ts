import { NextResponse } from "next/server";
import { z } from "zod";

import { asNumber } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { invoiceAmounts, invoiceBalanceInclude } from "@/lib/invoices/balance";
import { createInvoiceRecord, InvoiceInputError } from "@/lib/invoices/create";
import { documentCustomerSchema, upsertDocumentCustomer } from "@/lib/invoices/customers";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { requestText, rotRutErrorResponse } from "@/lib/invoices/http";
import { computeInvoiceStatus } from "@/lib/invoices/status";
import { InvoiceVatModes } from "@/lib/invoices/types";

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  vatMode: z.enum([InvoiceVatModes.NO_VAT, InvoiceVatModes.INCLUSIVE, InvoiceVatModes.EXCLUSIVE]),
  vatRate: z.number().min(0).max(1).default(0),
  // ROT/RUT invoices only.
  rotRutLabour: z.boolean().optional(),
  rotRutWorkType: z.string().trim().max(40).nullable().optional(),
  rotRutHours: z.number().min(0).max(9999).nullable().optional()
});

/** The customer gets ROT or RUT: the type and the buyer's details. Checked in lib/invoices/rotrut.ts. */
const rotRutSchema = z.object({
  type: z.enum(["ROT", "RUT"]),
  personnummer: z.string().trim().max(20),
  housing: z.enum(["property", "apartment"]).optional(),
  propertyDesignation: z.string().trim().max(80).optional(),
  brfOrgNumber: z.string().trim().max(20).optional(),
  apartmentNumber: z.string().trim().max(40).optional(),
  subcontractor: z.boolean().optional(),
  staffingAgency: z.boolean().optional()
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
  customer: documentCustomerSchema,
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
  signatureDataUrl: z.string().trim().max(1_500_000).optional(),
  rotRut: rotRutSchema.optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const customerId = searchParams.get("customerId")?.trim() || undefined;
  const limitRaw = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;
  const today = stockholmToday();

  const invoices = await prisma.invoice.findMany({
    where: {
      businessId,
      ...(customerId ? { customerId } : {}),
      ...(query
        ? {
            OR: [
              { invoiceNumber: { contains: query, mode: "insensitive" } },
              { customerName: { contains: query, mode: "insensitive" } },
              { ocrReference: { contains: query } }
            ]
          }
        : {})
    },
    include: invoiceBalanceInclude,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: limit
  });

  return NextResponse.json({
    invoices: invoices.map((invoice) => {
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
        ocrReference: invoice.ocrReference,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        grossAmount: amounts.grossAmount,
        paidAmount: amounts.paidAmount,
        creditedAmount: amounts.creditedAmount,
        remainingAmount: status.remaining,
        rotRutType: invoice.rotRutType,
        skatteverketAmount: amounts.skatteverketAmount,
        status: status.kind,
        overdue: status.overdue,
        days: status.days,
        sentAt: invoice.sentAt,
        reminderCount: invoice.reminderCount,
        lastReminderAt: invoice.lastReminderAt
      };
    })
  });
}

export async function POST(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = createInvoiceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Never echo what was typed for the ROT/RUT buyer: it is a personnummer.
    return NextResponse.json(
      { error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid invoice." },
      { status: 422 }
    );
  }
  const payload = parsed.data;

  const issueDate = parseIsoDate(payload.issueDate);
  if (!issueDate) {
    return NextResponse.json({ error: "Invalid issue date." }, { status: 400 });
  }

  // No due date sent: createInvoiceRecord applies the business payment terms.
  const dueDate = payload.dueDate ? parseIsoDate(payload.dueDate) : null;
  if (payload.dueDate && !dueDate) {
    return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
  }
  if (dueDate && dueDate < issueDate) {
    return NextResponse.json({ error: "The due date cannot be before the invoice date." }, { status: 400 });
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const customer = await upsertDocumentCustomer(tx, businessId, payload.customer);

      return createInvoiceRecord(tx, {
        businessId,
        customerId: customer.id,
        customer,
        items: payload.items,
        issueDate,
        dueDate,
        currency: payload.currency,
        invoiceNumber: payload.invoiceNumber,
        projectName: payload.projectName,
        description: payload.description,
        notes: payload.notes,
        paymentMethod: payload.paymentMethod,
        paymentDetails: payload.paymentDetails,
        sender: payload.sender,
        logoDataUrl: payload.logoDataUrl,
        signatureDataUrl: payload.signatureDataUrl,
        emailTo: payload.emailTo || customer.email,
        rotRut: payload.rotRut
      });
    });

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ocrReference: invoice.ocrReference,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalAmount: asNumber(invoice.subtotalAmount),
        vatAmount: asNumber(invoice.vatAmount),
        grossAmount: asNumber(invoice.grossAmount),
        vatRate: asNumber(invoice.vatRate),
        currency: invoice.currency,
        status: invoice.status,
        rotRutType: invoice.rotRutType,
        rotRutDeduction: invoice.rotRutDeduction === null ? null : asNumber(invoice.rotRutDeduction),
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
    if (error instanceof InvoiceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const rotRutProblem = rotRutErrorResponse(error, await requestText());
    if (rotRutProblem) return rotRutProblem;
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Invoice number already exists." }, { status: 409 });
    }
    throw error;
  }
}
