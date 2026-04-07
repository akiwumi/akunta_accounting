import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { stripe } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { businessId } = await requireAuthContext();

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
