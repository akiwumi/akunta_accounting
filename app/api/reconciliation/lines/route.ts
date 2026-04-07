import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { asNumber } from "@/lib/accounting/math";
import { getReconciliationStats } from "@/lib/reconciliation/finalize";

const lineSchema = z.object({
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().min(1).max(500),
  amount: z.number(),
  currency: z.string().length(3).default("SEK"),
  externalId: z.string().max(120).optional()
});

export const dynamic = "force-dynamic";

// GET — list bank statement lines with optional status filter
export async function GET(request: Request) {
  try {
    const { businessId } = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // UNMATCHED | MATCHED | IGNORED

    const lines = await prisma.bankStatementLine.findMany({
      where: {
        businessId,
        ...(status ? { status } : {})
      },
      orderBy: { txnDate: "desc" },
      take: 500
    });

    const stats = await getReconciliationStats(businessId);

    return NextResponse.json({
      lines: lines.map((l) => ({ ...l, amount: asNumber(l.amount) })),
      stats
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

// POST — manually add a bank statement line
export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json();
    const parsed = lineSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { txnDate, bookingDate, description, amount, currency, externalId } = parsed.data;

    const line = await prisma.bankStatementLine.create({
      data: {
        businessId,
        txnDate: new Date(`${txnDate}T00:00:00.000Z`),
        bookingDate: bookingDate ? new Date(`${bookingDate}T00:00:00.000Z`) : undefined,
        description,
        amount,
        currency,
        externalId,
        status: "UNMATCHED"
      }
    });

    return NextResponse.json({ ...line, amount: asNumber(line.amount) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
