import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
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

  const { businessId } = await requireAuthContext();
  const invoice = await loadInvoiceForOutput({
    businessId,
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

  const fromAddress = getDefaultEmailFromAddress(invoice.businessInvoiceEmailFrom?.trim());
  const subject = payload.subject?.trim() || `Invoice ${invoice.invoiceNumber}`;
  const filename = `invoice-${sanitizeFileNamePart(invoice.invoiceNumber)}.pdf`;
  const html = buildHtml({
    message: payload.message,
    invoiceNumber: invoice.invoiceNumber,
    amount: formattedAmount
  });

  if (isResendConfigured()) {
    await sendEmailViaResend({
      from: fromAddress,
      to: payload.to,
      subject,
      html,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }]
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
      from: fromAddress,
      to: payload.to,
      subject,
      html,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }]
    });
  }

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
