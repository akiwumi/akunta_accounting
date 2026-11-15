import { NextResponse } from "next/server";
import { z } from "zod";

import { journalErrorResponse, unauthorized } from "@/app/api/journal/errors";
import {
  loadVatBalances,
  suggestDepreciation,
  suggestYearEndReceivables,
  yearEndPayablesBooked
} from "@/lib/accounting/journalTemplates";
import { requireAuthContext } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const year = z.coerce.number().int().min(1990).max(2100);
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("depreciation"), year }),
  z.object({ kind: z.literal("receivables"), year }),
  z.object({ kind: z.literal("payables"), year }),
  z.object({ kind: z.literal("vat"), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
]);

/**
 * GET /api/journal/suggestions?kind=depreciation|receivables|payables&year=YYYY
 * GET /api/journal/suggestions?kind=vat&periodEnd=YYYY-MM-DD
 *
 * Figures from the books that prefill a guided entry. Read only.
 */
export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return unauthorized();
  }

  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", code: "INPUT" }, { status: 422 });
  }

  try {
    const query = parsed.data;
    if (query.kind === "depreciation") return NextResponse.json(await suggestDepreciation(businessId, query.year));
    if (query.kind === "receivables") return NextResponse.json(await suggestYearEndReceivables(businessId, query.year));
    if (query.kind === "payables") {
      return NextResponse.json({ year: query.year, alreadyBooked: await yearEndPayablesBooked(businessId, query.year) });
    }
    const periodEnd = new Date(`${query.periodEnd}T23:59:59.999Z`);
    if (Number.isNaN(periodEnd.valueOf())) {
      return NextResponse.json({ error: "Invalid date.", code: "INPUT" }, { status: 422 });
    }
    return NextResponse.json(await loadVatBalances(businessId, periodEnd));
  } catch (error) {
    return journalErrorResponse(error);
  }
}
