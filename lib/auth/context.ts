import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { AUTH_COOKIE_NAME, getSessionByToken } from "@/lib/auth/session";

export type AuthContext = {
  userId: string;
  businessId: string;
  role: string;
};

// Used by all route handlers and server components.
export const getAuthContext = async (): Promise<AuthContext | null> => {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await getSessionByToken(token);
  if (!session) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, businessId: session.businessId }
  });
  if (!membership) return null;

  return { userId: session.userId, businessId: session.businessId, role: membership.role };
};

// Throws if not authenticated — use inside route handlers.
export const requireAuthContext = async (): Promise<AuthContext> => {
  const ctx = await getAuthContext();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
};

// ─── Audit log helper ─────────────────────────────────────────────────────────

export const writeAuditLog = async (
  businessId: string,
  userId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown
) => {
  try {
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: userId ?? undefined,
        entityType,
        entityId,
        action,
        beforeJson: before !== undefined ? JSON.stringify(before) : undefined,
        afterJson: after !== undefined ? JSON.stringify(after) : undefined
      }
    });
  } catch {
    // audit failures must not break the main flow
  }
};
