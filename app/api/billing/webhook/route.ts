import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { stripe, getPlan } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Stripe sends raw bodies — must parse as text, not JSON.
export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 500 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Webhook signature verification failed." }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error("[webhook] handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      const businessId = session.metadata?.businessId;
      const plan = session.metadata?.plan ?? "starter";
      if (!businessId) break;

      await prisma.subscription.upsert({
        where: { businessId },
        create: {
          businessId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          plan,
          status: "active"
        },
        update: {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          plan,
          status: "active"
        }
      });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const businessId = sub.metadata?.businessId;
      if (!businessId) break;

      const priceId = sub.items.data[0]?.price.id ?? null;
      const plan = resolvePlanFromPriceId(priceId);

      // billing_cycle_anchor used as period reference (current_period_start/end removed in API 2026-03)
      const periodStart = new Date(sub.billing_cycle_anchor * 1000);
      const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000) : null;

      await prisma.subscription.upsert({
        where: { businessId },
        create: {
          businessId,
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          plan,
          status: sub.status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: cancelAt,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null
        },
        update: {
          stripePriceId: priceId,
          plan,
          status: sub.status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: cancelAt,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null
        }
      });
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const businessId = sub.metadata?.businessId;
      if (!businessId) break;

      await prisma.subscription.updateMany({
        where: { businessId },
        data: { status: "canceled", plan: "free" }
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: { status: "past_due" }
      });
      break;
    }
  }
}

function resolvePlanFromPriceId(priceId: string | null): string {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_STARTER_MONTHLY) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  return getPlan(priceId);
}
