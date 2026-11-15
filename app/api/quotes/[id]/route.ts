/**
 * PATCH  /api/quotes/[id]   edit the quote, or set its status (accepted, declined, sent, draft)
 * DELETE /api/quotes/[id]   delete it
 *
 * Both are allowed until the quote has been turned into an invoice.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";
import { upsertDocumentCustomer } from "@/lib/invoices/customers";
import { parseIsoDate } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";
import { canEditQuote } from "@/lib/invoices/quotes";

import { quoteInputSchema } from "../schema";

const statusSchema = z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED"]) });

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const invoicedMessage = (t: (sv: string, en: string) => string) =>
  t(
    "Offerten är fakturerad och kan inte ändras. Gör ändringen på fakturan med en kreditfaktura i stället.",
    "This quote has been invoiced and can no longer be changed. Correct the invoice with a credit note instead."
  );

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();
  const body: unknown = await request.json().catch(() => null);

  const quote = await prisma.quote.findFirst({
    where: { id: (await context.params).id, businessId },
    select: { id: true, status: true, sentAt: true }
  });
  if (!quote) return jsonError(t("Offerten hittades inte.", "Quote not found."), 404);
  if (!canEditQuote(quote.status)) return jsonError(invoicedMessage(t), 409);

  const statusChange = statusSchema.safeParse(body);
  if (statusChange.success) {
    const status = statusChange.data.status;
    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: {
        status,
        acceptedAt: status === "ACCEPTED" ? new Date() : null,
        sentAt: status === "SENT" ? (quote.sentAt ?? new Date()) : status === "DRAFT" ? null : undefined
      },
      select: { id: true, status: true }
    });
    return NextResponse.json({ quote: updated });
  }

  const parsed = quoteInputSchema.safeParse(body);
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);
  const payload = parsed.data;

  const issueDate = parseIsoDate(payload.issueDate);
  const validUntil = payload.validUntil ? parseIsoDate(payload.validUntil) : null;
  if (!issueDate) return jsonError(t("Ogiltigt datum.", "Invalid date."), 400);
  if (validUntil && validUntil < issueDate) {
    return jsonError(
      t("Giltighetsdatumet kan inte ligga före offertdatumet.", "The valid until date cannot be before the quote date."),
      400
    );
  }
  const computed = computeInvoiceTotals(payload.items);
  if (computed.items.length === 0) {
    return jsonError(t("Offerten behöver minst en rad.", "The quote needs at least one line."), 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const customer = await upsertDocumentCustomer(tx, businessId, payload.customer);
    await tx.quoteItem.deleteMany({ where: { quoteId: quote.id } });
    return tx.quote.update({
      where: { id: quote.id },
      data: {
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        customerAddress: customer.address,
        projectName: payload.projectName?.trim() || null,
        description: payload.description?.trim() || null,
        notes: payload.notes?.trim() || null,
        issueDate,
        validUntil,
        currency: payload.currency,
        subtotalAmount: computed.subtotal,
        vatAmount: computed.vatAmount,
        grossAmount: computed.grossAmount,
        items: { create: computed.items.map((item, index) => ({ sortOrder: index, ...item })) }
      },
      select: { id: true, quoteNumber: true, status: true }
    });
  });

  return NextResponse.json({ quote: updated });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const quote = await prisma.quote.findFirst({
    where: { id: (await context.params).id, businessId: auth.businessId },
    select: { id: true, status: true, invoiceId: true }
  });
  if (!quote) return jsonError(t("Offerten hittades inte.", "Quote not found."), 404);
  if (!canEditQuote(quote.status) || quote.invoiceId) {
    return jsonError(
      t(
        "Offerten är fakturerad och sparas som underlag till fakturan. Den kan därför inte tas bort.",
        "This quote has been invoiced and is kept as the basis for the invoice, so it cannot be deleted."
      ),
      409
    );
  }

  await prisma.quote.delete({ where: { id: quote.id } });
  return NextResponse.json({ deleted: true });
}
