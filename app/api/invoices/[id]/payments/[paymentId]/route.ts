/**
 * DELETE /api/invoices/[id]/payments/[paymentId]
 *
 * Undoes a registered payment. The ledger entry is never deleted: it is
 * cancelled with a reversing entry (voidTransaction), and the payment row is
 * kept so the history stays visible. The invoice status follows the new
 * balance.
 */

import { NextResponse } from "next/server";

import { voidTransaction } from "@/lib/accounting/ledger";
import { asNumber, round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { invoiceAmounts, invoiceBalanceInclude, storedStatusFor } from "@/lib/invoices/balance";
import { authOrNull, jsonError, postingErrorResponse, requestText, unauthorized } from "@/lib/invoices/http";
import { rotRutBlocksPaymentUndo, rotRutErrorText } from "@/lib/invoices/rotrut";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, props: { params: Promise<{ id: string; paymentId: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId, userId } = auth;
  const t = await requestText();
  const { id, paymentId } = await props.params;

  const payment = await prisma.invoicePayment.findFirst({
    where: { id: paymentId, invoiceId: id, businessId },
    include: {
      transaction: { select: { id: true, voidedAt: true } },
      invoice: { select: { invoiceNumber: true, rotRutType: true, rotRutRequestedAt: true, rotRutPaidOutAt: true } }
    }
  });
  if (!payment) return jsonError(t("Betalningen hittades inte.", "Payment not found."), 404);
  if (!payment.transaction || payment.transaction.voidedAt) {
    return jsonError(t("Betalningen är redan ångrad.", "This payment has already been undone."), 409);
  }
  // ROT/RUT: the request to Skatteverket rests on this payment, so it cannot disappear from under it.
  if (payment.invoice.rotRutType) {
    const current = await prisma.invoice.findFirstOrThrow({ where: { id, businessId }, include: invoiceBalanceInclude });
    const amounts = invoiceAmounts(current);
    const code = rotRutBlocksPaymentUndo({
      ...payment.invoice,
      settledAfterUndo: round2(amounts.paidAmount + amounts.creditedAmount - asNumber(payment.amount)),
      customerPart: round2(amounts.grossAmount - asNumber(current.rotRutDeduction ?? 0))
    });
    if (code) return jsonError(t(rotRutErrorText(code, "sv"), rotRutErrorText(code, "en")), 409);
  }
  const transactionId = payment.transaction.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { reversal } = await voidTransaction(tx, {
        businessId,
        transactionId,
        userId,
        reason: `Payment on invoice ${payment.invoice.invoiceNumber} undone`
      });

      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id, businessId },
        include: invoiceBalanceInclude
      });
      const amounts = invoiceAmounts({ ...invoice, status: "UNPAID" });
      const status = storedStatusFor(amounts);
      await tx.invoice.update({
        where: { id },
        data: status === "PAID" ? { status } : { status, paidAt: null }
      });
      return { reversal, remaining: amounts.remainingAmount };
    });

    return NextResponse.json({
      reversalVerificationNumber: result.reversal.verificationNumber,
      remaining: result.remaining
    });
  } catch (error) {
    const mapped = postingErrorResponse(error, t);
    if (mapped) return mapped;
    throw error;
  }
}
