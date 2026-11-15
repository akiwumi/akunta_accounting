/**
 * POST /api/invoices/[id]/refund
 *
 * Registers that a refund credited earlier has now been paid out, and books
 * it on that day. See registerRefundPayout in lib/invoices/credit.ts.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { CreditError, registerRefundPayout } from "@/lib/invoices/credit";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, postingErrorResponse, requestText, unauthorized } from "@/lib/invoices/http";

const schema = z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  const paidOn = parsed.success ? parseIsoDate(parsed.data.paidOn) : null;
  if (!paidOn) return jsonError(t("Ogiltigt datum.", "Invalid date."), 400);
  if (paidOn > stockholmToday()) {
    return jsonError(t("Utbetalningsdatumet kan inte ligga i framtiden.", "The payout date cannot be in the future."), 400);
  }

  try {
    const result = await registerRefundPayout(prisma, {
      businessId: auth.businessId,
      invoiceId: (await props.params).id,
      paidOn
    });
    return NextResponse.json({ refunded: result.refunded, transactions: result.transactions.length }, { status: 201 });
  } catch (error) {
    if (error instanceof CreditError) {
      return jsonError(
        error.code === "not_found"
          ? t("Fakturan hittades inte.", "Invoice not found.")
          : t(
              "Det finns ingen återbetalning som väntar på att betalas ut för den här fakturan.",
              "There is no refund waiting to be paid out on this invoice."
            ),
        error.status
      );
    }
    const mapped = postingErrorResponse(error, t);
    if (mapped) return mapped;
    return jsonError(error instanceof Error ? error.message : "Error", 500);
  }
}
