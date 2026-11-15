/**
 * POST /api/invoices/[id]/recurring
 *
 * "Repeat this invoice": saves the invoice's customer and lines as a
 * recurring template. The job at /api/cron/recurring-invoices then creates a
 * new invoice on each run date.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { asNumber } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { daysBetween, parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

const schema = z.object({
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  autoSend: z.boolean().default(false)
});

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const nextRunDate = parseIsoDate(parsed.data.nextRunDate);
  const endDate = parsed.data.endDate ? parseIsoDate(parsed.data.endDate) : null;
  if (!nextRunDate || nextRunDate < stockholmToday()) {
    return jsonError(
      t("Nästa fakturadatum måste vara i dag eller senare.", "The next invoice date must be today or later."),
      400
    );
  }
  if (endDate && endDate < nextRunDate) {
    return jsonError(
      t("Slutdatumet kan inte ligga före nästa fakturadatum.", "The end date cannot be before the next invoice date."),
      400
    );
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: (await props.params).id, businessId },
    include: { items: { orderBy: { sortOrder: "asc" } }, business: { select: { defaultPaymentTermsDays: true } } }
  });
  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);
  if (parsed.data.autoSend && !(invoice.emailTo ?? invoice.customerEmail)) {
    return jsonError(
      t(
        "Kunden saknar e-postadress, så fakturorna kan inte skickas automatiskt. Lägg till en adress på kunden eller stäng av automatiskt utskick.",
        "The customer has no email address, so invoices cannot be sent automatically. Add an address to the customer or turn automatic sending off."
      ),
      400
    );
  }

  const template = await prisma.recurringInvoice.create({
    data: {
      businessId,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerEmail: invoice.emailTo ?? invoice.customerEmail,
      customerAddress: invoice.customerAddress,
      description: invoice.description ?? invoice.projectName,
      notes: invoice.notes,
      itemsJson: JSON.stringify(
        invoice.items.map((item) => ({
          description: item.description,
          quantity: asNumber(item.quantity),
          unitPrice: asNumber(item.unitPrice),
          vatMode: item.vatMode,
          vatRate: asNumber(item.vatRate)
        }))
      ),
      currency: invoice.currency,
      frequency: parsed.data.frequency,
      nextRunDate,
      endDate,
      paymentTermsDays: invoice.dueDate
        ? Math.max(0, daysBetween(invoice.issueDate, invoice.dueDate))
        : invoice.business.defaultPaymentTermsDays,
      autoSend: parsed.data.autoSend
    }
  });

  return NextResponse.json({ recurringInvoice: { id: template.id, nextRunDate: template.nextRunDate } }, { status: 201 });
}
