/**
 * POST /api/year-end/close
 *
 * Close a fiscal year for the authenticated business.
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

import { requireAuthContext } from "@/lib/auth/context";
import { closeFiscalYear } from "@/lib/accounting/year-end";

const bodySchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  retainedEarningsAccountCode: z.string().min(1).max(10).optional(),
});

export async function POST(request: Request) {
  const { businessId } = await requireAuthContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  const { fiscalYear, retainedEarningsAccountCode } = parsed.data;

  try {
    const summary = await closeFiscalYear(
      businessId,
      fiscalYear,
      retainedEarningsAccountCode
    );
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Year-end close failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
