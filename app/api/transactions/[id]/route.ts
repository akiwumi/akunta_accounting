import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { assertDateNotLocked, ledgerErrorResponse, voidTransaction, writeLedgerAudit } from "@/lib/accounting/ledger";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const patchSchema = z
  .object({
    description: z.string().trim().min(1).max(200).optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    txnDate: z.string().optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided."
  });

export async function PATCH(request: Request, context: RouteContext) {
  const transactionId = (await context.params).id;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
  }

  const { businessId, userId } = await requireAuthContext();
  const payload = patchSchema.parse(await request.json());
  const parsedDate = payload.txnDate ? new Date(`${payload.txnDate}T00:00:00.000Z`) : undefined;
  if (parsedDate && Number.isNaN(parsedDate.valueOf())) {
    return NextResponse.json({ error: "Invalid transaction date." }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId, businessId },
    select: { id: true, paidInvoiceId: true, description: true, reference: true, txnDate: true, voidedAt: true, reversesTransactionId: true }
  });
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  }
  if (existing.voidedAt || existing.reversesTransactionId) {
    return NextResponse.json(
      { error: "A cancelled verification or a correcting entry cannot be edited." },
      { status: 409 }
    );
  }

  try {
  const updated = await prisma.$transaction(async (tx) => {
    // Amounts and accounts are immutable. Text and date may change, but never
    // into or out of a locked period, and always with an audit trail.
    await assertDateNotLocked(tx, businessId, existing.txnDate);
    if (parsedDate) await assertDateNotLocked(tx, businessId, parsedDate);

    const transaction = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.reference !== undefined ? { reference: payload.reference?.trim() || null } : {}),
        ...(parsedDate ? { txnDate: parsedDate } : {})
      },
      select: {
        id: true,
        description: true,
        reference: true,
        txnDate: true
      }
    });

    if (parsedDate && existing.paidInvoiceId) {
      await tx.invoice.update({
        where: { id: existing.paidInvoiceId },
        data: { paidAt: parsedDate }
      });
    }

    await writeLedgerAudit(tx, {
      businessId,
      userId,
      entityType: "Transaction",
      entityId: transactionId,
      action: "UPDATE",
      before: { description: existing.description, reference: existing.reference, txnDate: existing.txnDate },
      after: { description: transaction.description, reference: transaction.reference, txnDate: transaction.txnDate }
    });

    return transaction;
  });

  return NextResponse.json(updated);
  } catch (error) {
    const mapped = ledgerErrorResponse(error);
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    throw error;
  }
}

/**
 * "Delete" cancels the verification with a reversing entry. Nothing is removed:
 * the original and its correction both stay in the ledger.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const transactionId = (await context.params).id;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
  }

  const { businessId, userId } = await requireAuthContext();
  const reason = new URL(request.url).searchParams.get("reason")?.trim() || "Cancelled by user";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { original, reversal } = await voidTransaction(tx, { businessId, transactionId, userId, reason });

      if (original.paidInvoiceId) {
        await tx.invoice.update({
          where: { id: original.paidInvoiceId },
          data: { status: "UNPAID", paidAt: null }
        });
      }

      return { original, reversal };
    });

    return NextResponse.json({
      // Kept for existing callers: the id that no longer counts.
      deletedTransactionId: transactionId,
      voidedTransactionId: transactionId,
      reversalTransactionId: result.reversal.id,
      reversalVerificationNumber: result.reversal.verificationNumber
    });
  } catch (error) {
    const mapped = ledgerErrorResponse(error);
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    throw error;
  }
}
