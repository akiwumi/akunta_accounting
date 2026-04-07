import { prisma } from "@/lib/db";

// ─── Membership-based resolution ─────────────────────────────────────────────

export const getBusinessById = async (businessId: string) => {
  return prisma.business.findUnique({
    where: { id: businessId },
    include: { taxConfig: true }
  });
};

export const requireBusiness = async (businessId: string) => {
  const business = await getBusinessById(businessId);
  if (!business) throw new Error(`Business not found: ${businessId}`);
  return business;
};

export const getUserBusiness = async (userId: string) => {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      business: { include: { taxConfig: true } }
    }
  });
  return membership?.business ?? null;
};

// ─── Legacy shim — used by routes that haven't been migrated yet ──────────────
// Returns the first business in DB (single-tenant fallback for development).
// All production routes must use requireAuthContextFromRequest + requireBusiness instead.

export const ensureBusiness = async () => {
  const existing = await prisma.business.findFirst({
    include: { taxConfig: true }
  });
  if (existing) return existing;

  throw new Error(
    "No business found. Please register an account to set up your business."
  );
};
