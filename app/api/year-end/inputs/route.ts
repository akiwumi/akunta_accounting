/**
 * GET /api/year-end/inputs?year=2026
 *   The user's own answers for the year-end of that year.
 *
 * PUT /api/year-end/inputs
 *   Body: { year: number, ...patch }. Only the fields sent are changed. A
 *   manual box set to null is cleared again.
 *
 * The answers are stored as a draft filing of type "NE". They never touch the
 * ledger, so they can be changed after the year has been closed.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { requireAuthContext } from "@/lib/auth/context";
import { parseTaxYear } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { getYearEndInputs, saveYearEndInputs, yearEndInputsSchema } from "@/lib/tax/neYearEnd";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();
  const year = parseTaxYear(new URL(request.url).searchParams.get("year"));
  if (year === null || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year query parameter is required (e.g. ?year=2026)." }, { status: 400 });
  }
  return NextResponse.json({ year, inputs: await getYearEndInputs(businessId, year) });
}

const bodySchema = yearEndInputsSchema.extend({ year: z.number().int().min(2000).max(2100) });

export async function PUT(request: Request) {
  const { businessId, userId } = await requireAuthContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation error." }, { status: 422 });
  }

  const { year, ...patch } = parsed.data;
  const inputs = await saveYearEndInputs(businessId, year, patch);
  // Which answers changed is logged, not their content: the patch can hold a person number.
  await writeLedgerAudit(prisma, {
    businessId,
    userId,
    entityType: "YearEnd",
    entityId: String(year),
    action: "UPDATE_INPUTS",
    after: { fields: Object.keys(patch) }
  });
  return NextResponse.json({ year, inputs });
}
