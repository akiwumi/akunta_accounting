/**
 * POST /api/invoices/[id]/partial-pay
 *
 * Registers a payment of any size up to what remains on the invoice. Each
 * payment is booked in the ledger on its payment date (kontantmetoden), with
 * VAT split at the invoice's rate.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { invoiceAmounts, invoiceBalanceInclude } from "@/lib/invoices/balance";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { registerInvoicePayment } from "@/lib/invoices/payments";
import { authOrNull, jsonError, postingErrorResponse, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

const partialPaySchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional()
});

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();

  const parsed = partialPaySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const { reference, notes } = parsed.data;
  const amount = round2(parsed.data.amount);
  const txnDate = parseIsoDate(parsed.data.paymentDate);
  if (!txnDate) return jsonError(t("Ogiltigt betalningsdatum.", "Invalid payment date."), 400);
  if (txnDate > stockholmToday()) {
    return jsonError(
      t("Betalningsdatumet kan inte ligga i framtiden.", "The payment date cannot be in the future."),
      400
    );
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: (await props.params).id, businessId },
    include: invoiceBalanceInclude
  });
  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);
  if (invoice.status === "VOID") return jsonError(t("Fakturan är makulerad.", "Invoice is voided."), 409);

  const amounts = invoiceAmounts(invoice);
  const remaining = amounts.remainingAmount;
  if (remaining <= 0) return jsonError(t("Fakturan är redan betald.", "This invoice is already paid."), 409);
  if (amount > round2(remaining + 0.01)) {
    return jsonError(
      t(
        `Beloppet ${amount} är större än det som återstår att betala (${remaining}).`,
        `The amount ${amount} is more than what remains to be paid (${remaining}).`
      ),
      422
    );
  }

  try {
    const result = await registerInvoicePayment(prisma, {
      businessId,
      invoiceId: invoice.id,
      amount,
      paymentDate: txnDate,
      reference,
      notes
    });
    return NextResponse.json(
      { payment: result.payment, transaction: result.transaction, fullyPaid: result.fullyPaid, remaining: result.remaining },
      { status: 201 }
    );
  } catch (error) {
    const mapped = postingErrorResponse(error, t);
    if (mapped) return mapped;
    return jsonError(error instanceof Error ? error.message : "Error", 500);
  }
}
