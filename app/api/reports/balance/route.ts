import { NextResponse } from "next/server";

import { buildBalanceSheet } from "@/lib/accounting/reports";
import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { getFiscalYearStartMonth, resolveReportPeriod } from "@/lib/data/period";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();
  const business = await requireBusiness(businessId);
  const period = resolveReportPeriod(
    new URL(request.url).searchParams,
    getFiscalYearStartMonth(business.fiscalYearStart)
  );
  const report = await buildBalanceSheet({ businessId, ...period });
  return NextResponse.json(report);
}
