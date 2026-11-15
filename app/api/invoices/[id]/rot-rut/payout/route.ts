/**
 * POST /api/invoices/[id]/rot-rut/payout
 *
 * "Skatteverket has paid": books the amount received on the day it arrived
 * and stores the entry on the invoice (rotRutPayoutTransactionId). If the
 * amount is lower than requested, the difference is the customer's to pay
 * and the invoice is open again for it; newDueDate gives them a date.
 *
 * DELETE takes the payout back with a reversing entry.
 *
 * What is booked and why: lib/invoices/rotrut-actions.ts.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { parseIsoDate, stockholmToday } from "@/lib/invoices/dates";
import {
  authOrNull,
  jsonError,
  postingErrorResponse,
  requestText,
  rotRutErrorResponse,
  unauthorized,
  zodMessage
} from "@/lib/invoices/http";
import { registerRotRutPayout, undoRotRutPayout } from "@/lib/invoices/rotrut-actions";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const payoutSchema = z.object({
  paidOn: isoDay,
  amount: z.number().min(0),
  newDueDate: isoDay.optional().or(z.literal(""))
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = payoutSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  const today = stockholmToday();
  const paidOn = parseIsoDate(parsed.data.paidOn);
  const newDueDate = parsed.data.newDueDate ? parseIsoDate(parsed.data.newDueDate) : null;
  if (!paidOn || (parsed.data.newDueDate && !newDueDate)) return jsonError(t("Ogiltigt datum.", "Invalid date."), 400);

  try {
    const result = await registerRotRutPayout(prisma, {
      businessId: auth.businessId,
      invoiceId: (await props.params).id,
      paidOn,
      amount: parsed.data.amount,
      newDueDate,
      today
    });
    return NextResponse.json(
      {
        transactionId: result.transaction?.id ?? null,
        verificationNumber: result.transaction?.verificationNumber ?? null,
        amount: result.amount,
        shortfall: result.shortfall
      },
      { status: 201 }
    );
  } catch (error) {
    const mapped = rotRutErrorResponse(error, t) ?? postingErrorResponse(error, t);
    if (mapped) return mapped;
    return jsonError(error instanceof Error ? error.message : "Error", 500);
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  try {
    const result = await undoRotRutPayout(prisma, {
      businessId: auth.businessId,
      invoiceId: (await props.params).id,
      userId: auth.userId
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = rotRutErrorResponse(error, t) ?? postingErrorResponse(error, t);
    if (mapped) return mapped;
    throw error;
  }
}
