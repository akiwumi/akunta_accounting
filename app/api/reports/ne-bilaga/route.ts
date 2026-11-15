import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { getFiscalYearStartMonth, resolveReportPeriod } from "@/lib/data/period";
import { buildNeForPeriod, neRows } from "@/lib/tax/neRows";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();
  const business = await requireBusiness(businessId);
  const period = resolveReportPeriod(
    new URL(request.url).searchParams,
    getFiscalYearStartMonth(business.fiscalYearStart)
  );
  // Same computation as the guided year-end at /year-end.
  const ne = await buildNeForPeriod(businessId, period.to);
  return NextResponse.json({
    incomeYear: ne.incomeYear,
    result: ne.result,
    fillInYourself: ne.fillInYourself,
    rows: neRows(ne),
    guide: "/year-end"
  });
}
