import { NextResponse } from "next/server";

import { buildBalanceSheet } from "@/lib/accounting/reports";
import { ensureBusiness } from "@/lib/data/business";
import { resolveReportPeriod } from "@/lib/data/period";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const business = await ensureBusiness();
  const period = resolveReportPeriod(new URL(request.url).searchParams);
  const report = await buildBalanceSheet({ businessId: business.id, ...period });
  return NextResponse.json(report);
}
