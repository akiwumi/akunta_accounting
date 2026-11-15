/**
 * POST /api/year-end/close
 *
 * Close a fiscal year for the authenticated business: lock the year and carry
 * the balances forward as next year's opening balances.
 *
 * Body:
 *   {
 *     fiscalYear: number,                       // e.g. 2024
 *     retainedEarningsAccountCode?: string      // default "2010"
 *   }
 *
 * On success:
 *   {
 *     fiscalYear, openingBalancesCreated, periodLockCreated, netPnl,
 *     retainedEarningsAccountCode
 *   }
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { closeFiscalYear } from "@/lib/accounting/year-end";
import { requireAuthContext } from "@/lib/auth/context";

const bodySchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  retainedEarningsAccountCode: z.string().min(1).max(10).optional(),
});

export async function POST(request: Request) {
  const { businessId, userId } = await requireAuthContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  const { fiscalYear, retainedEarningsAccountCode } = parsed.data;

  // A year that has not ended cannot be closed: entries would still arrive.
  const yearEnd = new Date(Date.UTC(fiscalYear, 11, 31, 23, 59, 59, 999));
  if (new Date() <= yearEnd) {
    return NextResponse.json(
      { error: `Fiscal year ${fiscalYear} has not ended yet. It can be closed from 1 January ${fiscalYear + 1}.` },
      { status: 409 }
    );
  }

  let summary: Awaited<ReturnType<typeof closeFiscalYear>>;
  try {
    // The lock and the audit row are written inside closeFiscalYear's own transaction.
    summary = await closeFiscalYear(businessId, fiscalYear, retainedEarningsAccountCode, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Year-end close failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(summary);
}
