import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { MomsFilingError, recordMomsFiling } from "@/lib/tax/momsdeklaration";
import { findVatPeriod, swedishToday, vatPeriodOptionsFor } from "@/lib/tax/vat-periods";

export const dynamic = "force-dynamic";

const schema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/),
  /** Lock the period so nothing more can be booked into it. On by default. */
  lock: z.boolean().default(true)
});

/**
 * POST /api/vat-return/filed
 *
 * "I have filed this": records the return as filed at Skatteverket, writes an
 * audit row and, by default, locks the period.
 */
export async function POST(request: Request) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 422 });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { vatFrequency: true, fiscalYearStart: true, orgType: true }
    });
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

    const period = findVatPeriod(parsed.data.period, vatPeriodOptionsFor(business));
    if (!period) return NextResponse.json({ error: "Unknown reporting period." }, { status: 404 });

    if (swedishToday() <= period.end.toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "This period has not ended yet, so it cannot have been filed." }, { status: 422 });
    }

    const result = await recordMomsFiling({ businessId, userId, period, lock: parsed.data.lock });

    return NextResponse.json(
      {
        filingId: result.filing.id,
        submittedAt: result.filing.submittedAt,
        boxes: result.declaration.boxes,
        locked: result.locked,
        lockError: result.lockError
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof MomsFilingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
