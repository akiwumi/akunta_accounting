/**
 * PATCH  /api/recurring-invoices/[id]   pause, resume or stop a template, or change its schedule
 * DELETE /api/recurring-invoices/[id]   remove the template (invoices already created are kept)
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patchSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]).optional(),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
  nextRunDate: isoDay.optional(),
  endDate: isoDay.nullable().optional(),
  autoSend: z.boolean().optional()
});

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const template = await prisma.recurringInvoice.findFirst({
    where: { id: (await props.params).id, businessId: auth.businessId }
  });
  if (!template) return jsonError(t("Den återkommande fakturan hittades inte.", "Recurring invoice not found."), 404);

  const today = stockholmToday();
  const data: {
    active?: boolean;
    endDate?: Date | null;
    nextRunDate?: Date;
    frequency?: string;
    autoSend?: boolean;
  } = {};

  if (parsed.data.frequency) data.frequency = parsed.data.frequency;
  if (parsed.data.autoSend !== undefined) {
    if (parsed.data.autoSend && !template.customerEmail) {
      return jsonError(
        t(
          "Kunden saknar e-postadress, så fakturorna kan inte skickas automatiskt.",
          "The customer has no email address, so invoices cannot be sent automatically."
        ),
        400
      );
    }
    data.autoSend = parsed.data.autoSend;
  }
  if (parsed.data.nextRunDate) {
    const nextRunDate = parseIsoDate(parsed.data.nextRunDate);
    if (!nextRunDate || nextRunDate < today) {
      return jsonError(
        t("Nästa fakturadatum måste vara i dag eller senare.", "The next invoice date must be today or later."),
        400
      );
    }
    data.nextRunDate = nextRunDate;
  }
  if (parsed.data.endDate !== undefined) {
    data.endDate = parsed.data.endDate ? parseIsoDate(parsed.data.endDate) : null;
  }

  if (parsed.data.action === "pause") data.active = false;
  if (parsed.data.action === "stop") {
    data.active = false;
    data.endDate = today;
  }
  if (parsed.data.action === "resume") {
    data.active = true;
    // A stopped template gets its end date cleared, and a run date that passed
    // while it was resting starts again from today instead of sending a backlog.
    if (template.endDate && template.endDate <= today && parsed.data.endDate === undefined) data.endDate = null;
    if (!data.nextRunDate && template.nextRunDate < today) data.nextRunDate = today;
  }

  const updated = await prisma.recurringInvoice.update({ where: { id: template.id }, data });
  return NextResponse.json({
    recurringInvoice: {
      id: updated.id,
      active: updated.active,
      nextRunDate: updated.nextRunDate,
      endDate: updated.endDate,
      autoSend: updated.autoSend,
      frequency: updated.frequency
    }
  });
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const deleted = await prisma.recurringInvoice.deleteMany({
    where: { id: (await props.params).id, businessId: auth.businessId }
  });
  if (deleted.count === 0) {
    return jsonError(t("Den återkommande fakturan hittades inte.", "Recurring invoice not found."), 404);
  }
  return NextResponse.json({ deleted: true });
}
