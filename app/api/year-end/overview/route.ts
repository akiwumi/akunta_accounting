/**
 * GET /api/year-end/overview?year=2026
 *
 * The guided year-end for one fiscal year: open items, the NE-bilaga with
 * every box, the tax estimate and whether the SRU files can be produced.
 */

import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { parseTaxYear } from "@/lib/data/period";
import { buildYearEndOverview } from "@/lib/tax/neYearEnd";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();
  const year = parseTaxYear(new URL(request.url).searchParams.get("year"));
  if (year === null || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year query parameter is required (e.g. ?year=2026)." }, { status: 400 });
  }
  const overview = await buildYearEndOverview(businessId, year);
  return NextResponse.json(overview);
}
