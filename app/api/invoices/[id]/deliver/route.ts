/**
 * POST /api/invoices/[id]/deliver
 *
 * Unified invoice delivery abstraction.
 *
 * Body:
 *   { method: "email" | "peppol", to?: string, subject?: string, message?: string }
 *
 * - method "email":  sends the PDF by email (delegates to the existing send logic)
 * - method "peppol": generates PEPPOL BIS 3.0 UBL 2.1 XML and returns it as a
 *                    download. In production, wire this to a PEPPOL Access Point
 *                    client (e.g. Inexchange, Pagero, or a direct AS4 connection).
 *                    The XML is also stored on the Filing record for audit.
 *
 * The route updates Invoice.sentAt on success.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { buildInvoicePdf } from "@/lib/invoices/pdf";
import {
  generatePeppolInvoice,
  buildPeppolInputFromInvoice,
} from "@/lib/integrations/einvoice/peppol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

const deliverSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("email"),
    to: z.string().trim().email(),
    subject: z.string().trim().max(180).optional(),
    message: z.string().trim().max(5000).optional(),
  }),
  z.object({
    method: z.literal("peppol"),
    buyerReference: z.string().trim().max(80).optional(),
  }),
]);

export async function POST(request: Request, { params }: RouteContext) {
  const { businessId } = await requireAuthContext();
  const { id } = params;

  const invoice = await prisma.invoice.findFirst({
    where: { id, businessId },
    include: { items: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = deliverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  const data = parsed.data;

  // ── Email delivery ─────────────────────────────────────────────────────────
  if (data.method === "email") {
    const invoiceData = await loadInvoiceForOutput({ invoiceId: id, businessId });
    if (!invoiceData) {
      return NextResponse.json({ error: "Invoice data could not be loaded." }, { status: 404 });
    }

    const pdfBuffer = buildInvoicePdf({
      invoiceNumber: invoiceData.invoiceNumber,
      projectName: invoiceData.projectName,
      issueDate: invoiceData.issueDate,
      dueDate: invoiceData.dueDate,
      currency: invoiceData.currency,
      sender: {
        name: invoiceData.senderName,
        address: invoiceData.senderAddress,
        registration: invoiceData.senderOrgNumber,
        email: invoiceData.senderEmail,
        phone: invoiceData.senderPhone,
        website: invoiceData.senderWebsite,
      },
      customer: {
        name: invoiceData.customerName,
        address: invoiceData.customerAddress,
        email: invoiceData.customerEmail,
        phone: invoiceData.customerPhone,
        website: invoiceData.customerWebsite,
      },
      items: invoiceData.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatAmount: item.vatAmount,
        totalAmount: item.totalAmount,
      })),
      subtotalAmount: invoiceData.subtotalAmount,
      vatAmount: invoiceData.vatAmount,
      grossAmount: invoiceData.grossAmount,
      notes: invoiceData.notes,
      paymentMethod: invoiceData.paymentMethod,
      paymentDetails: invoiceData.paymentDetails,
    });
    const sanitize = (v: string) =>
      v.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";

    const pdfFilename = `invoice-${sanitize(invoice.invoiceNumber)}.pdf`;
    const subject =
      data.subject ?? `Invoice ${invoice.invoiceNumber} from ${invoice.senderName ?? business.name}`;
    const html = data.message
      ? `<p>${data.message.replace(/\n/g, "<br>")}</p>`
      : `<p>Please find your invoice ${invoice.invoiceNumber} attached.</p>`;

    const from = getDefaultEmailFromAddress(business.invoiceEmailFrom ?? undefined);

    if (isResendConfigured()) {
      await sendEmailViaResend({
        from,
        to: data.to,
        subject,
        html,
        attachments: [{ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" }]
      });
    } else {
      const smtp = getSmtpConfig();
      if (!smtp.ok) {
        return NextResponse.json(
          { error: "Email delivery is not configured. Set RESEND_API_KEY or SMTP credentials." },
          { status: 503 }
        );
      }
      const transporter = createSmtpTransport(smtp.config);
      await transporter.sendMail({
        from,
        to: data.to,
        subject,
        html,
        attachments: [{ filename: pdfFilename, content: pdfBuffer }]
      });
    }

    await prisma.invoice.update({
      where: { id },
      data: { sentAt: new Date(), emailTo: data.to },
    });

    return NextResponse.json({ ok: true, method: "email", to: data.to });
  }

  // ── PEPPOL delivery ────────────────────────────────────────────────────────
  if (data.method === "peppol") {
    const peppolInput = buildPeppolInputFromInvoice(
      {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate ?? undefined,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        customerAddress: invoice.customerAddress,
        senderName: invoice.senderName,
        senderAddress: invoice.senderAddress,
        senderOrgNumber: invoice.senderOrgNumber,
        senderEmail: invoice.senderEmail,
        notes: invoice.notes,
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          vatRate: Number(item.vatRate),
          netAmount: Number(item.netAmount),
          vatAmount: Number(item.vatAmount),
        })),
      },
      {
        vatNumber: business.vatNumber,
        peppolId: business.peppolId,
        fSkattRegistered: business.fSkattRegistered,
        personnummer: business.personnummer,
      }
    );

    if (data.buyerReference) {
      peppolInput.buyerReference = data.buyerReference;
    }

    const { xml, filename } = generatePeppolInvoice(peppolInput);

    // Record a Filing entry for the PEPPOL dispatch
    await prisma.filing.create({
      data: {
        businessId,
        filingType: "PEPPOL_INVOICE",
        periodStart: invoice.issueDate,
        periodEnd: invoice.dueDate ?? invoice.issueDate,
        status: "SUBMITTED",
        externalRef: invoice.invoiceNumber,
        payloadJson: xml,
        submittedAt: new Date(),
      },
    });

    await prisma.invoice.update({
      where: { id },
      data: { sentAt: new Date() },
    });

    // Return the XML as a downloadable response.
    // In production, also POST to your PEPPOL Access Point endpoint here.
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Peppol-Profile": "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      },
    });
  }

  return NextResponse.json({ error: "Unknown delivery method." }, { status: 400 });
}
