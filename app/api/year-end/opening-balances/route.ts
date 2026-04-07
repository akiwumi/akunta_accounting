/**
 * GET  /api/year-end/opening-balances?year=2025
 *   Returns all opening balances stored for the given fiscal year.
 *
 * POST /api/year-end/opening-balances
 *   Upsert a single opening balance manually.
 *   Body: { year: number, accountId: string, amount: number }
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { getOpeningBalances, upsertOpeningBalance } from "@/lib/accounting/year-end";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : null;

  if (!year || isNaN(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "year query parameter is required (e.g. ?year=2025)." },
      { status: 400 }
    );
  }

  const balances = await getOpeningBalances(businessId, year);
  return NextResponse.json({ year, balances });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  accountId: z.string().min(1),
  amount: z.number(),
});

export async function POST(request: Request) {
  const { businessId } = await requireAuthContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  const { year, accountId, amount } = parsed.data;

  try {
    await upsertOpeningBalance(businessId, accountId, year, amount);
    return NextResponse.json({ ok: true, year, accountId, amount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save opening balance.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
