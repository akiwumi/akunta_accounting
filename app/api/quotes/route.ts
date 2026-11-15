/**
 * GET  /api/quotes   list
 * POST /api/quotes   create a quote, numbered from the business pattern (quoteNumberPattern)
 *
 * Nothing here touches the ledger: a quote is not a bookkeeping record.
 */

import { NextResponse } from "next/server";

import { asNumber } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";
import { upsertDocumentCustomer } from "@/lib/invoices/customers";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { effectiveQuoteStatus } from "@/lib/invoices/quotes";

import { quoteInputSchema } from "./schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const today = stockholmToday();
  const quotes = await prisma.quote.findMany({
    where: {
      businessId: auth.businessId,
      ...(query
        ? {
            OR: [
              { quoteNumber: { contains: query, mode: "insensitive" } },
              { customerName: { contains: query, mode: "insensitive" } },
              { projectName: { contains: query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 300
  });

  return NextResponse.json({
    quotes: quotes.map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      customerId: quote.customerId,
      customerName: quote.customerName,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      grossAmount: asNumber(quote.grossAmount),
      currency: quote.currency,
      status: effectiveQuoteStatus(quote, today),
      invoiceId: quote.invoiceId
    }))
  });
}

export async function POST(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();

  const parsed = quoteInputSchema.safeParse(await request.json().catch(() => null));
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

  const quote = await prisma.$transaction(async (tx) => {
    const customer = await upsertDocumentCustomer(tx, businessId, payload.customer);
    // Incrementing first locks the business row, so two quotes never share a number.
    const business = await tx.business.update({
      where: { id: businessId },
      data: { nextQuoteSequence: { increment: 1 } },
      select: { quoteNumberPattern: true, nextQuoteSequence: true }
    });
    const quoteNumber = formatInvoiceNumber({
      pattern: business.quoteNumberPattern || "OFF-{YYYY}-{SEQ:4}",
      sequence: business.nextQuoteSequence - 1,
      issueDate
    });

    return tx.quote.create({
      data: {
        businessId,
        customerId: customer.id,
        quoteNumber,
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
        status: "DRAFT",
        items: {
          create: computed.items.map((item, index) => ({ sortOrder: index, ...item }))
        }
      },
      select: { id: true, quoteNumber: true }
    });
  });

  return NextResponse.json({ quote }, { status: 201 });
}
