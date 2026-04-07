import { NextResponse } from "next/server";

import { buildProfitAndLoss } from "@/lib/accounting/reports";
import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { getFiscalYearStartMonth, resolveReportPeriod } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { resolveAndEstimate } from "@/lib/tax/engines";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();
  const business = await requireBusiness(businessId);
  const period = resolveReportPeriod(
    new URL(request.url).searchParams,
    getFiscalYearStartMonth(business.fiscalYearStart)
  );
  const [pnl, countryProfile] = await Promise.all([
    buildProfitAndLoss({ businessId, ...period }),
    prisma.countryTaxProfile.findUnique({
      where: { businessId },
      include: { incomeTaxBands: { orderBy: { bandOrder: "asc" } } }
    })
  ]);

  try {
    const result = resolveAndEstimate(pnl.operatingProfit, business, countryProfile);
    return NextResponse.json({ period, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Tax estimate failed." },
      { status: 500 }
    );
  }
}
