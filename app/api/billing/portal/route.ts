import { NextResponse } from "next/server";

import { authErrorResponse, requireOwner } from "@/lib/auth/context";
import { stripe } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { businessId } = await requireOwner();

    const sub = await prisma.subscription.findFirst({ where: { businessId } });
    if (!sub?.stripeCustomerId) {
      return NextResponse.json({ error: "No billing account found. Start a subscription first." }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl}/settings/billing`
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    // Billing belongs to the owner: 401/403 instead of a generic 500.
    const denied = authErrorResponse(error);
    if (denied) return denied;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
