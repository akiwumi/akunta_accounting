import { NextResponse } from "next/server";
import { z } from "zod";

import { authErrorResponse, requireOwner } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { stripe, getOrCreateStripeCustomer, PLANS, type PlanKey } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db";

const checkoutSchema = z.object({
  plan: z.enum(["starter", "pro"]),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional()
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { businessId, userId } = await requireOwner();
    const business = await requireBusiness(businessId);

    const body = await request.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

    const { plan, successUrl, cancelUrl } = parsed.data;
    const planConfig = PLANS[plan as PlanKey];
    if (!planConfig.priceId) {
      return NextResponse.json({ error: `Stripe price not configured for plan: ${plan}` }, { status: 503 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const customerId = await getOrCreateStripeCustomer(businessId, business.name, user.email);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: successUrl ?? `${appUrl}/settings/billing?success=1`,
      cancel_url: cancelUrl ?? `${appUrl}/settings/billing?cancelled=1`,
      metadata: { businessId, plan },
      subscription_data: {
        metadata: { businessId, plan },
        trial_period_days: 7
      },
      allow_promotion_codes: true
    });

    return NextResponse.json({ url: session.url }, { status: 201 });
  } catch (error) {
    // Billing belongs to the owner: 401/403 instead of a generic 500.
    const denied = authErrorResponse(error);
    if (denied) return denied;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
