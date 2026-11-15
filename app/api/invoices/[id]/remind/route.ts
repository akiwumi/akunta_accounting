/**
 * POST /api/invoices/[id]/remind
 *
 * Emails a polite payment reminder with the invoice PDF attached and counts
 * it on the invoice (reminderCount, lastReminderAt). No fee or interest is
 * added: see lib/invoices/reminders.ts for the legal background.
 *
 * GET returns the default subject and text, for the dialog preview.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { defaultReminderEmail, sendInvoiceReminder } from "@/lib/invoices/delivery";
import { authOrNull, jsonError, requestText, unauthorized } from "@/lib/invoices/http";
import { loadInvoiceForOutput } from "@/lib/invoices/load";

type RouteContext = { params: Promise<{ id: string }> };

const remindSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().max(5000).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const invoice = await loadInvoiceForOutput({ businessId: auth.businessId, invoiceId: (await context.params).id });
  if (!invoice) return jsonError("Invoice not found.", 404);
  return NextResponse.json({ to: invoice.emailTo ?? invoice.customerEmail ?? "", ...defaultReminderEmail(invoice) });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = remindSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(t("Ange en giltig e-postadress.", "Enter a valid email address."), 422);

  const invoice = await loadInvoiceForOutput({ businessId: auth.businessId, invoiceId: (await context.params).id });
  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);
  if (invoice.status === "VOID" || invoice.remainingAmount <= 0) {
    return jsonError(
      t("Fakturan är redan betald, så ingen påminnelse behövs.", "This invoice is already settled, so no reminder is needed."),
      409
    );
  }

  const result = await sendInvoiceReminder(invoice, parsed.data);
  if (!result.ok) {
    if (result.reason === "already_sent") {
      return jsonError(t("En påminnelse skickades precis för den här fakturan.", result.message), 409);
    }
    return jsonError(
      result.reason === "not_configured"
        ? t(
            "E-post är inte konfigurerad på servern ännu, så påminnelsen kunde inte skickas.",
            "Email is not set up on the server yet, so the reminder could not be sent."
          )
        : t(`Påminnelsen kunde inte skickas: ${result.message}`, `The reminder could not be sent: ${result.message}`),
      result.reason === "not_configured" ? 503 : 502
    );
  }

  return NextResponse.json({
    invoiceId: invoice.id,
    remindedTo: parsed.data.to,
    reminderCount: invoice.reminderCount + 1
  });
}
