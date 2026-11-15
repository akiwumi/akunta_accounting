import { NextResponse } from "next/server";
import { z } from "zod";

import { AccountError, createAccount, listAccountsWithBalances } from "@/lib/accounting/accounts";
import { requireAuthContext } from "@/lib/auth/context";
import { AccountTypes } from "@/lib/domain/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().max(200),
  type: z.enum([AccountTypes.ASSET, AccountTypes.LIABILITY, AccountTypes.EQUITY, AccountTypes.INCOME, AccountTypes.EXPENSE]).optional()
});

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** GET /api/accounts?year=YYYY: every account with its balance for the year. */
export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return unauthorized();
  }
  const raw = new URL(request.url).searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : new Date().getUTCFullYear();
  return NextResponse.json({ year, accounts: await listAccountsWithBalances(businessId, year) });
}

/** POST /api/accounts: add an account to the chart. */
export async function POST(request: Request) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return unauthorized();
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INPUT" }, { status: 422 });
  }

  try {
    const account = await createAccount({ businessId, userId, ...parsed.data });
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof AccountError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[accounts]", error);
    return NextResponse.json({ error: "The account could not be added." }, { status: 500 });
  }
}
