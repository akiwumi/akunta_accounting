import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import {
  buildMomsdeklaration,
  findMomsFiling,
  findMomsFilings,
  matchMomsFiling,
  UNSUPPORTED_BOX_GROUPS,
  vatActiveFrom
} from "@/lib/tax/momsdeklaration";
import { findVatPeriod, listVatPeriods, vatPeriodOptionsFor, vatPeriodStatus } from "@/lib/tax/vat-periods";

export const dynamic = "force-dynamic";

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * GET /api/vat-return                 the reporting periods with status and deadline
 * GET /api/vat-return?period=<key>    the return per box for one period
 */
export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, vatFrequency: true, fiscalYearStart: true, orgType: true }
    });
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

    const options = vatPeriodOptionsFor(business);
    const key = new URL(request.url).searchParams.get("period");

    if (!key) {
      const periods = listVatPeriods(options, new Date(), await vatActiveFrom(business));
      const filings = await findMomsFilings(businessId);
      const withStatus = periods.map((period) => {
        const filing = matchMomsFiling(filings, period);
        return {
          key: period.key,
          from: day(period.start),
          to: day(period.end),
          deadline: day(period.deadline),
          deadlineRule: period.deadlineRule,
          status: vatPeriodStatus(period, { filed: filing !== null }),
          filedAt: filing?.submittedAt ?? null
        };
      });
      return NextResponse.json({ frequency: options.frequency, periods: withStatus });
    }

    const period = findVatPeriod(key, options);
    if (!period) return NextResponse.json({ error: "Unknown reporting period." }, { status: 404 });

    const [declaration, filing] = await Promise.all([
      buildMomsdeklaration({ businessId, from: period.start, to: period.end }),
      findMomsFiling(businessId, period)
    ]);

    return NextResponse.json({
      period: {
        key: period.key,
        from: day(period.start),
        to: day(period.end),
        skvPeriod: period.skvPeriod,
        deadline: day(period.deadline),
        deadlineRule: period.deadlineRule,
        status: vatPeriodStatus(period, { filed: filing !== null }),
        filedAt: filing?.submittedAt ?? null
      },
      boxes: declaration.boxes,
      exact: declaration.exact,
      unsupportedBoxes: UNSUPPORTED_BOX_GROUPS.flatMap((group) => group.boxes),
      crossCheck: declaration.crossCheck,
      blockers: declaration.blockers,
      salesWithoutVat: declaration.salesWithoutVat,
      entries: declaration.entries
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
