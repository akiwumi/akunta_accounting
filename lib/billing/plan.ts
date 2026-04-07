import { prisma } from "@/lib/db";
import { PLANS, getPlan, type PlanKey } from "@/lib/billing/stripe";

export type PlanLimits = (typeof PLANS)[PlanKey]["limits"];

// ─── Resolve current plan for a business ─────────────────────────────────────

export const getBusinessPlan = async (businessId: string): Promise<PlanKey> => {
  const sub = await prisma.subscription.findFirst({ where: { businessId } });
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  return getPlan(sub.plan);
};

export const getPlanLimits = async (businessId: string): Promise<PlanLimits> => {
  const plan = await getBusinessPlan(businessId);
  return PLANS[plan].limits;
};

// ─── Feature gates ────────────────────────────────────────────────────────────

/**
 * Throws if the business is on a plan that doesn't include the feature.
 * Usage: await requirePlan(businessId, "starter")
 */
export const requirePlan = async (businessId: string, minimumPlan: PlanKey): Promise<void> => {
  const planOrder: PlanKey[] = ["free", "starter", "pro"];
  const current = await getBusinessPlan(businessId);
  const currentIndex = planOrder.indexOf(current);
  const requiredIndex = planOrder.indexOf(minimumPlan);
  if (currentIndex < requiredIndex) {
    const planName = PLANS[minimumPlan].name;
    throw new Error(`This feature requires the ${planName} plan or higher. Upgrade in Settings > Billing.`);
  }
};

// ─── Usage checks ─────────────────────────────────────────────────────────────

export const checkReceiptLimit = async (businessId: string): Promise<void> => {
  const limits = await getPlanLimits(businessId);
  if (limits.receiptsPerMonth === Infinity) return;

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const count = await prisma.receipt.count({
    where: { businessId, createdAt: { gte: start } }
  });
  if (count >= limits.receiptsPerMonth) {
    throw new Error(
      `Monthly receipt limit (${limits.receiptsPerMonth}) reached. Upgrade your plan to add more receipts.`
    );
  }
};

export const checkInvoiceLimit = async (businessId: string): Promise<void> => {
  const limits = await getPlanLimits(businessId);
  if (limits.invoicesPerMonth === Infinity) return;

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const count = await prisma.invoice.count({
    where: { businessId, createdAt: { gte: start } }
  });
  if (count >= limits.invoicesPerMonth) {
    throw new Error(
      `Monthly invoice limit (${limits.invoicesPerMonth}) reached. Upgrade your plan to add more invoices.`
    );
  }
};

export const checkEmployeeLimit = async (businessId: string): Promise<void> => {
  const limits = await getPlanLimits(businessId);
  if (limits.employees === Infinity) return;

  const count = await prisma.employee.count({
    where: { businessId, status: "ACTIVE" }
  });
  if (count >= limits.employees) {
    throw new Error(
      `Employee limit (${limits.employees}) reached for your plan. Upgrade to add more employees.`
    );
  }
};
