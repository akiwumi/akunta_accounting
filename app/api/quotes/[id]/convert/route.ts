/** POST /api/quotes/[id]/convert: "Turn into invoice". See convertQuoteToInvoice. */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { InvoiceInputError } from "@/lib/invoices/create";
import { stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, unauthorized } from "@/lib/invoices/http";
import { convertQuoteToInvoice, QuoteError } from "@/lib/invoices/quotes";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  try {
    const invoice = await convertQuoteToInvoice(prisma, {
      businessId: auth.businessId,
      quoteId: (await context.params).id,
      today: stockholmToday()
    });
    return NextResponse.json(
      { invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof QuoteError) {
      const message =
        error.code === "not_found"
          ? t("Offerten hittades inte.", "Quote not found.")
          : error.code === "declined"
            ? t(
                "Offerten är markerad som avböjd. Ändra status först om kunden har ändrat sig.",
                "This quote is marked as declined. Change its status first if the customer has changed their mind."
              )
            : t("Offerten har redan gjorts om till en faktura.", "This quote has already been turned into an invoice.");
      return jsonError(message, error.status);
    }
    if (error instanceof InvoiceInputError) return jsonError(error.message, error.status);
    throw error;
  }
}
