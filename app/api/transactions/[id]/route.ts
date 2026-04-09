import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    id: string;
  };
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
  const transactionId = context.params.id;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
  }

  const { businessId } = await requireAuthContext();
  const payload = patchSchema.parse(await request.json());
  const parsedDate = payload.txnDate ? new Date(`${payload.txnDate}T00:00:00.000Z`) : undefined;
  if (parsedDate && Number.isNaN(parsedDate.valueOf())) {
    return NextResponse.json({ error: "Invalid transaction date." }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId, businessId },
    select: { id: true, paidInvoiceId: true }
  });
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
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

    return transaction;
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const transactionId = context.params.id;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
  }

  const { businessId } = await requireAuthContext();

  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId, businessId },
    select: { id: true, paidInvoiceId: true }
  });
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.delete({
      where: { id: transactionId }
    });

    if (existing.paidInvoiceId) {
      await tx.invoice.update({
        where: { id: existing.paidInvoiceId },
        data: {
          status: "UNPAID",
          paidAt: null
        }
      });
    }
  });

  return NextResponse.json({ deletedTransactionId: transactionId });
}
