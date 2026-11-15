import { redirect } from "next/navigation";

import { getAuthContext, getUserContext } from "@/lib/auth/context";
import { canWrite, isOwnerRole, type Role } from "@/lib/auth/roles";
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

// ─── Current business for server components ──────────────────────────────────
// Resolves the business from the signed-in session. It must never fall back to
// "any business in the database": that would show one customer another
// customer's books.

/**
 * Where to send a visitor who has no usable business: someone signed in but
 * not a member of the session's business gets the page that explains it;
 * anyone else signs in again. (?expired=1 tells the proxy to show the form
 * even though a stale session cookie is still present.)
 */
const redirectWithoutBusiness = async (): Promise<never> => {
  const user = await getUserContext();
  redirect(user ? "/login/no-access" : "/login?expired=1");
};

export const ensureBusiness = async () => {
  const ctx = await getAuthContext();
  if (!ctx) return redirectWithoutBusiness();

  const business = await getBusinessById(ctx.businessId);
  if (!business) return redirectWithoutBusiness();
  return business;
};

// ─── The signed-in person's rights in the current business ───────────────────

export type BusinessAccess = {
  userId: string;
  businessId: string;
  role: Role;
  /** Owner or accountant. False for a read-only member: hide or disable anything that saves. */
  canWrite: boolean;
  /** Members, invitations, billing and the identity of the business. */
  isOwner: boolean;
};

/**
 * For pages: what the signed-in person may do here, so a page can leave out
 * actions that would be refused. Display only. The server refuses the request
 * regardless (requireAuthContext), so forgetting to hide a button is not a hole.
 *
 *   const access = await getBusinessAccess();
 *   {access.canWrite && <NewInvoiceButton />}
 */
export const getBusinessAccess = async (): Promise<BusinessAccess> => {
  const ctx = await getAuthContext();
  if (!ctx) return redirectWithoutBusiness();
  return {
    userId: ctx.userId,
    businessId: ctx.businessId,
    role: ctx.role,
    canWrite: canWrite(ctx.role),
    isOwner: isOwnerRole(ctx.role)
  };
};
