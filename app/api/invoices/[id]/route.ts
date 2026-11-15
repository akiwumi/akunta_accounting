/**
 * PATCH /api/invoices/[id]
 *
 * The few things that may change on an issued invoice. Its number, lines and
 * amounts are never editable (corrections are credit notes); what can change
 * is whether it counts as sent and, when the customer has been given more
 * time, the due date.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

const patchSchema = z.object({
  markSent: z.boolean().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const invoice = await prisma.invoice.findFirst({
    where: { id: (await props.params).id, businessId: auth.businessId },
    select: { id: true, issueDate: true, sentAt: true }
  });
  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);

  const data: { sentAt?: Date | null; dueDate?: Date } = {};
  if (parsed.data.markSent === true && !invoice.sentAt) data.sentAt = new Date();
  if (parsed.data.markSent === false) data.sentAt = null;
  if (parsed.data.dueDate) {
    const dueDate = parseIsoDate(parsed.data.dueDate);
    if (!dueDate || dueDate < invoice.issueDate) {
      return jsonError(
        t("Förfallodatumet kan inte ligga före fakturadatumet.", "The due date cannot be before the invoice date."),
        400
      );
    }
    data.dueDate = dueDate;
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data,
    select: { id: true, sentAt: true, dueDate: true }
  });
  return NextResponse.json({ invoice: updated });
}
