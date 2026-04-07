import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[billing] STRIPE_SECRET_KEY is not set — billing features will be unavailable.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder", {
  apiVersion: "2025-03-31.basil"
});

// ─── Plan definitions ─────────────────────────────────────────────────────────

export const PLANS = {
  free: {
    name: "Free",
    priceId: null,
    limits: {
      receiptsPerMonth: 20,
      invoicesPerMonth: 5,
      employees: 1
    }
  },
  starter: {
    name: "Starter",
    priceId: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? null,
    limits: {
      receiptsPerMonth: 200,
      invoicesPerMonth: 50,
      employees: 3
    }
  },
  pro: {
    name: "Pro",
    priceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? null,
    limits: {
      receiptsPerMonth: Infinity,
      invoicesPerMonth: Infinity,
      employees: Infinity
    }
  }
} as const;

export type PlanKey = keyof typeof PLANS;

export const getPlan = (plan: string): PlanKey => {
  if (plan in PLANS) return plan as PlanKey;
  return "free";
};

// ─── Customer management ──────────────────────────────────────────────────────

export const getOrCreateStripeCustomer = async (
  businessId: string,
  businessName: string,
  email: string
): Promise<string> => {
  const { prisma } = await import("@/lib/db");

  const sub = await prisma.subscription.findFirst({ where: { businessId } });
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await stripe.customers.create({
    name: businessName,
    email,
    metadata: { businessId }
  });

  await prisma.subscription.upsert({
    where: { businessId },
    create: { businessId, stripeCustomerId: customer.id, plan: "free", status: "active" },
    update: { stripeCustomerId: customer.id }
  });

  return customer.id;
};
