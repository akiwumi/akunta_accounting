/**
 * POST /api/payments/received
 *
 * Books money received from a customer. When the reference is the number (or
 * OCR reference) of an invoice that still has something to pay, the payment
 * is registered on that invoice the same way as on the invoice page
 * (lib/invoices/payments.ts): a payment row is created and only what the
 * customer has left to pay is settled. On an invoice with ROT or RUT that is
 * the customer's part, never Skatteverket's.
 *
 * Money beyond what was left on the invoice is not booked: the response says
 * how much it is, so the user can register it separately or pay it back.
 * Without a matching invoice the whole amount is booked as income, as before.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { ledgerErrorResponse } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { asNumber } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { getRequestLocale } from "@/lib/i18n/locale";
import { registerPaymentByReference } from "@/lib/invoices/payments";

const paymentReceivedSchema = z.object({
  payer: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200).optional(),
  paymentDate: z.string().min(10),
  grossAmount: z.number().positive(),
  vatRate: z.number().min(0).max(1).default(0.25),
  currency: z.enum(["SEK", "EUR", "GBP"]).default("SEK"),
  reference: z.string().trim().max(120).optional(),
  incomeAccountCode: z.string().trim().min(4).max(10).default("3001")
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = paymentReceivedSchema.parse(await request.json());
  const { businessId } = await requireAuthContext();
  const sv = (await getRequestLocale()) === "sv";

  const paymentDate = new Date(`${payload.paymentDate}T00:00:00.000Z`);
  if (Number.isNaN(paymentDate.valueOf())) {
    return NextResponse.json({ error: "Invalid payment date." }, { status: 400 });
  }

  const normalizedReference = payload.reference?.trim() || undefined;

  try {
    const onInvoice = await registerPaymentByReference(prisma, {
      businessId,
      reference: normalizedReference,
      amount: payload.grossAmount,
      currency: payload.currency,
      paymentDate,
      description: payload.description,
      incomeAccountCode: payload.incomeAccountCode
    });

    if (onInvoice && !onInvoice.ok) {
      return NextResponse.json(
        {
          error: sv
            ? `Faktura ${onInvoice.invoiceNumber} är i ${onInvoice.currency}. Ange betalningen i samma valuta.`
            : `Invoice ${onInvoice.invoiceNumber} is in ${onInvoice.currency}. Enter the payment in the same currency.`
        },
        { status: 422 }
      );
    }

    if (onInvoice) {
      const { invoice, matched, excess } = onInvoice;
      const notice =
        excess > 0
          ? sv
            ? `${matched} ${invoice.currency} är bokfört på faktura ${invoice.invoiceNumber}, som nu är betald. Resterande ${excess} ${invoice.currency} är mer än vad som återstod på fakturan och är inte bokfört. Registrera det som en egen betalning eller betala tillbaka det.`
            : `${matched} ${invoice.currency} was booked on invoice ${invoice.invoiceNumber}, which is now paid. The remaining ${excess} ${invoice.currency} is more than what was left on the invoice and has not been booked. Register it as a payment of its own or pay it back.`
          : null;

      return NextResponse.json({
        transaction: {
          id: onInvoice.transaction.id,
          description: onInvoice.transaction.description,
          grossAmount: asNumber(onInvoice.transaction.grossAmount),
          currency: onInvoice.transaction.currency
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          matchedAmount: matched,
          remaining: onInvoice.remaining,
          fullyPaid: onInvoice.fullyPaid
        },
        /** Received beyond what was left on the invoice. Not booked. */
        excess,
        notice
      });
    }

    const transaction = await createCashMethodTransaction({
      businessId,
      txnDate: paymentDate,
      description: payload.description?.trim() || `Payment received from ${payload.payer}`,
      direction: TransactionDirections.INCOME,
      grossAmount: payload.grossAmount,
      vatRate: payload.vatRate,
      source: EntrySources.MANUAL,
      reference: normalizedReference || payload.payer,
      currency: payload.currency,
      incomeAccountCode: payload.incomeAccountCode
    });

    return NextResponse.json({
      transaction: {
        id: transaction.id,
        description: transaction.description,
        grossAmount: asNumber(transaction.grossAmount),
        currency: transaction.currency
      },
      invoice: null,
      excess: 0,
      notice: null
    });
  } catch (error) {
    const mapped = ledgerErrorResponse(error);
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    throw error;
  }
}
