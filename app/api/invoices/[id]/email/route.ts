import { NextResponse } from "next/server";
import { z } from "zod";

import { sendInvoiceEmail } from "@/lib/invoices/delivery";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";
import { loadInvoiceForOutput } from "@/lib/invoices/load";

type RouteContext = { params: Promise<{ id: string }> };

const sendInvoiceEmailSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(5000).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = sendInvoiceEmailSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError(t("Ange en giltig e-postadress.", "Enter a valid email address.") + ` (${zodMessage(parsed.error)})`, 422);
  }

  const invoice = await loadInvoiceForOutput({ businessId: auth.businessId, invoiceId: (await context.params).id });
  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);

  const result = await sendInvoiceEmail(invoice, parsed.data);
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

  return NextResponse.json({ invoiceId: invoice.id, emailedTo: parsed.data.to });
}
