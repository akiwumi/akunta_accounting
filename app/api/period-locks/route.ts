import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { lockPeriod, getLockedPeriods } from "@/lib/accounting/period-locks";

const lockSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const locks = await getLockedPeriods(businessId);
    return NextResponse.json(locks);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { businessId, userId } = await requireAuthContext();
    const body = await request.json();
    const parsed = lockSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { periodStart, periodEnd } = parsed.data;
    const start = new Date(`${periodStart}T00:00:00.000Z`);
    const end = new Date(`${periodEnd}T23:59:59.999Z`);
    if (end < start) return NextResponse.json({ error: "periodEnd must be after periodStart." }, { status: 422 });

    const lock = await lockPeriod(businessId, start, end, userId);
    return NextResponse.json(lock, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
