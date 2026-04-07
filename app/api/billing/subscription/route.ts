import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { PLANS, getPlan } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { businessId } = await requireAuthContext();

    const sub = await prisma.subscription.findFirst({ where: { businessId } });
    const planKey = getPlan(sub?.plan ?? "free");
    const planDetails = PLANS[planKey];

    return NextResponse.json({
      plan: planKey,
      planName: planDetails.name,
      status: sub?.status ?? "active",
      limits: planDetails.limits,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      trialEndsAt: sub?.trialEndsAt ?? null,
      hasStripeCustomer: Boolean(sub?.stripeCustomerId)
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
