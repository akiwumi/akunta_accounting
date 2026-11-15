/**
 * POST /api/invoices/[id]/pay
 *
 * Registers payment in full of an invoice nothing has been paid or credited
 * on yet. The payment is booked in the ledger on the payment date
 * (kontantmetoden). For part payments, or to pay off what remains, use
 * /partial-pay.
 *
 * On an invoice with ROT or RUT "in full" means the customer's part: the
 * invoice minus the tax reduction.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { invoiceAmounts, invoiceBalanceInclude } from "@/lib/invoices/balance";
import { isoDate, parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, postingErrorResponse, requestText, unauthorized } from "@/lib/invoices/http";
import { registerInvoicePayment } from "@/lib/invoices/payments";

const payInvoiceSchema = z.object({
  paymentDate: z.string().min(10).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();

  const parsed = payInvoiceSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(t("Ogiltigt betalningsdatum.", "Invalid payment date."), 400);
  const today = stockholmToday();
  const paymentDate = parseIsoDate(parsed.data.paymentDate ?? isoDate(today));
  if (!paymentDate) return jsonError(t("Ogiltigt betalningsdatum.", "Invalid payment date."), 400);
  if (paymentDate > today) {
    return jsonError(
      t("Betalningsdatumet kan inte ligga i framtiden.", "The payment date cannot be in the future."),
      400
    );
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: (await context.params).id, businessId },
    include: invoiceBalanceInclude
  });

  if (!invoice) return jsonError(t("Fakturan hittades inte.", "Invoice not found."), 404);
  if (invoice.status === "VOID") return jsonError(t("Fakturan är makulerad.", "Invoice is voided."), 409);

  const amounts = invoiceAmounts(invoice);
  if (amounts.remainingAmount <= 0) {
    return jsonError(t("Fakturan är redan betald.", "Invoice already marked as paid."), 409);
  }
  if (amounts.paidAmount > 0 || amounts.creditedAmount > 0) {
    return jsonError(
      t(
        "Fakturan är delvis betald eller krediterad. Registrera det som återstår som en delbetalning.",
        "This invoice is partly paid or credited. Register what remains as a part payment."
      ),
      409
    );
  }

  try {
    // ROT/RUT: "in full" is the customer's part. Skatteverket's part, and the VAT in it, is booked when it is paid out.
    const result = await registerInvoicePayment(prisma, {
      businessId,
      invoiceId: invoice.id,
      amount: amounts.remainingAmount,
      paymentDate
    });
    return NextResponse.json({ invoiceId: invoice.id, transactionId: result.transaction.id });
  } catch (error) {
    const mapped = postingErrorResponse(error, t);
    if (mapped) return mapped;
    return jsonError(error instanceof Error ? error.message : "Error", 500);
  }
}
