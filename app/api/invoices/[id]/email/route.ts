import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { buildInvoicePdf } from "@/lib/invoices/pdf";

type RouteContext = {
  params: {
    id: string;
  };
};

const sendInvoiceEmailSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(5000).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sanitizeFileNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "invoice";

const buildHtml = (input: { message?: string; invoiceNumber: string; amount: string }) => {
  const safeMessage = input.message?.trim() || "";
  const messageHtml = safeMessage
    ? `<p style="white-space:pre-line;">${safeMessage
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")}</p>`
    : "<p>Please find your invoice attached as a PDF.</p>";

  return [
    "<div style=\"font-family:Arial,sans-serif;color:#111827;line-height:1.5;\">",
    messageHtml,
    `<p><strong>Invoice:</strong> ${input.invoiceNumber}<br/><strong>Total:</strong> ${input.amount}</p>`,
    "<p>Thank you.</p>",
    "</div>"
  ].join("");
};

export async function POST(request: Request, context: RouteContext) {
  const invoiceId = context.params.id;
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice id." }, { status: 400 });
  }

  const payload = sendInvoiceEmailSchema.parse(await request.json().catch(() => ({})));

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT ?? "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpSecure = process.env.SMTP_SECURE === "true";

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    return NextResponse.json(
      {
        error:
          "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to enable invoice email."
      },
      { status: 400 }
    );
  }

  const business = await ensureBusiness();
  const invoice = await loadInvoiceForOutput({
    businessId: business.id,
    invoiceId
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const pdfBuffer = buildInvoicePdf({
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
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatAmount: item.vatAmount,
      totalAmount: item.totalAmount
    })),
    subtotalAmount: invoice.subtotalAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
    notes: invoice.notes,
    paymentMethod: invoice.paymentMethod,
    paymentDetails: invoice.paymentDetails
  });

  const formattedAmount = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: invoice.currency
  }).format(invoice.grossAmount);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const fromAddress =
    invoice.businessInvoiceEmailFrom?.trim() || process.env.SMTP_FROM?.trim() || smtpUser;
  const subject = payload.subject?.trim() || `Invoice ${invoice.invoiceNumber}`;
  const filename = `invoice-${sanitizeFileNamePart(invoice.invoiceNumber)}.pdf`;

  await transporter.sendMail({
    from: fromAddress,
    to: payload.to,
    subject,
    html: buildHtml({
      message: payload.message,
      invoiceNumber: invoice.invoiceNumber,
      amount: formattedAmount
    }),
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      sentAt: new Date(),
      emailTo: payload.to
    }
  });

  return NextResponse.json({
    invoiceId: invoice.id,
    emailedTo: payload.to
  });
}
