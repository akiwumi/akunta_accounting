/** POST /api/quotes/[id]/email: emails the quote PDF to the customer and marks the quote as sent. */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { sendEmail, textToHtml } from "@/lib/email/send";
import { formatDocumentMoney } from "@/lib/invoices/delivery";
import { authOrNull, jsonError, requestText, unauthorized } from "@/lib/invoices/http";
import { defaultQuoteEmail, loadQuoteForOutput, quotePdfFileName, renderQuotePdf } from "@/lib/invoices/quotes";

const schema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(5000).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(t("Ange en giltig e-postadress.", "Enter a valid email address."), 422);

  const quote = await loadQuoteForOutput(prisma, { businessId: auth.businessId, quoteId: (await context.params).id });
  if (!quote) return jsonError(t("Offerten hittades inte.", "Quote not found."), 404);

  const defaults = defaultQuoteEmail(quote, formatDocumentMoney(quote.grossAmount, quote.currency, quote.locale));
  const body = parsed.data.message?.trim() || defaults.body;
  const result = await sendEmail({
    from: quote.emailFrom,
    replyTo: quote.sender.email,
    to: parsed.data.to,
    subject: parsed.data.subject?.trim() || defaults.subject,
    text: body,
    html: textToHtml(body),
    attachments: [{ filename: quotePdfFileName(quote), content: renderQuotePdf(quote), contentType: "application/pdf" }]
  });
  if (!result.ok) {
    return jsonError(
      result.reason === "not_configured"
        ? t(
            "E-post är inte konfigurerad på servern ännu. Ladda ner PDF:en och skicka den själv så länge.",
            "Email is not set up on the server yet. Download the PDF and send it yourself for now."
          )
        : t(`E-postmeddelandet kunde inte skickas: ${result.message}`, `The email could not be sent: ${result.message}`),
      result.reason === "not_configured" ? 503 : 502
    );
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      sentAt: new Date(),
      customerEmail: quote.customerEmail ?? parsed.data.to,
      ...(quote.status === "DRAFT" ? { status: "SENT" } : {})
    }
  });

  return NextResponse.json({ quoteId: quote.id, emailedTo: parsed.data.to });
}
