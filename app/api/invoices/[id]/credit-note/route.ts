/**
 * POST /api/invoices/[id]/credit-note
 *
 * Credits all or part of an invoice. An issued invoice is never edited: a
 * credit note is the correction. What is booked is decided in
 * lib/invoices/credit.ts: under kontantmetoden only a refund of money
 * already received, on the day it is paid out (refundPaidOn).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { createCreditNote, CreditError } from "@/lib/invoices/credit";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, postingErrorResponse, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const creditNoteSchema = z.object({
  issueDate: isoDay,
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
  refundPaidOn: isoDay.optional().or(z.literal(""))
});

export const dynamic = "force-dynamic";

const creditErrorResponse = (error: CreditError, t: (sv: string, en: string) => string) => {
  const messages: Record<CreditError["code"], string> = {
    not_found: t("Fakturan hittades inte.", "Invoice not found."),
    void: t("Fakturan är makulerad.", "Invoice is voided."),
    fully_credited: t("Hela fakturan är redan krediterad.", "This invoice has already been credited in full."),
    too_much: t(
      `Du kan kreditera högst ${error.limit} på den här fakturan.`,
      `You can credit at most ${error.limit} on this invoice.`
    ),
    rot_rut_requested: t(
      "Begäran till Skatteverket är markerad som skickad. Ta tillbaka begäran hos Skatteverket och ångra markeringen på fakturan innan du krediterar.",
      "The request to Skatteverket is marked as sent. Withdraw the request at Skatteverket and undo the mark on the invoice before you credit it."
    ),
    rot_rut_full_only: t(
      `En faktura med rot eller rut kan bara krediteras i sin helhet (${error.limit}) innan Skatteverket har betalat ut. Kreditera hela fakturan och skapa en ny.`,
      `An invoice with ROT or RUT can only be credited in full (${error.limit}) before Skatteverket has paid out. Credit the whole invoice and create a new one.`
    ),
    nothing_to_refund: t(
      "Det finns ingen återbetalning som väntar på att betalas ut för den här fakturan.",
      "There is no refund waiting to be paid out on this invoice."
    )
  };
  return jsonError(messages[error.code], error.status);
};

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = creditNoteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const issueDate = parseIsoDate(parsed.data.issueDate);
  const refundPaidOn = parsed.data.refundPaidOn ? parseIsoDate(parsed.data.refundPaidOn) : null;
  if (!issueDate || (parsed.data.refundPaidOn && !refundPaidOn)) return jsonError(t("Ogiltigt datum.", "Invalid date."), 400);
  if (refundPaidOn && refundPaidOn > stockholmToday()) {
    return jsonError(
      t(
        "Återbetalningen kan inte ha betalats ut i framtiden. Lämna den som ej utbetald och registrera den när pengarna har gått iväg.",
        "The refund cannot have been paid out in the future. Leave it as not paid out and register it once the money has left."
      ),
      400
    );
  }

  try {
    const result = await createCreditNote(prisma, {
      businessId: auth.businessId,
      invoiceId: (await props.params).id,
      amount: parsed.data.amount,
      issueDate,
      reason: parsed.data.reason,
      refundPaidOn
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CreditError) return creditErrorResponse(error, t);
    const mapped = postingErrorResponse(error, t);
    if (mapped) return mapped;
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return jsonError(t("Försök igen om en stund.", "Please try again in a moment."), 409);
    }
    return jsonError(error instanceof Error ? error.message : "Error", 500);
  }
}

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const creditNotes = await prisma.creditNote.findMany({
    where: { invoiceId: (await props.params).id, businessId: auth.businessId },
    orderBy: { issueDate: "desc" }
  });
  return NextResponse.json(creditNotes);
}
