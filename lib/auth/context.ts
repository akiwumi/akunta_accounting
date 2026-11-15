import { NextResponse } from "next/server";
import { cache } from "react";

import { getRequestInfo, type RequestInfo } from "@/lib/auth/requestInfo";
import {
  ACCESS_DENIED_HEADER,
  type AccessDenial,
  checkAccess,
  denialMessage,
  normalizeRole,
  type Role,
  Roles
} from "@/lib/auth/roles";
import { getSessionByToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export type AuthContext = {
  userId: string;
  businessId: string;
  role: Role;
  sessionId: string;
};

/** No valid session, or the session's business is not one the person belongs to. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    // The message is what existing handlers print; keep it stable.
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** Signed in, but the role does not allow this request. */
export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code: AccessDenial | "role";
  constructor(code: AccessDenial | "role", message?: string) {
    super(message ?? (code === "role" ? "Your role does not allow this." : denialMessage(code, "en")));
    this.name = "ForbiddenError";
    this.code = code;
  }
}

// One session lookup per page render, however many helpers ask. Outside a
// server component render (route handlers, tests) this does not memoise.
const sessionForToken = cache((token: string) => getSessionByToken(token));

/**
 * Session token -> the person, the business and their role in it.
 *
 * The business always comes from the session row and the role always from the
 * Membership row for exactly that (user, business) pair. There is no other
 * way to obtain a context, so a member of business A cannot get one for B.
 */
export const resolveAuthContext = async (sessionToken: string | null | undefined): Promise<AuthContext | null> => {
  if (!sessionToken) return null;

  const session = await sessionForToken(sessionToken);
  if (!session || !session.businessId) return null;

  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: session.userId, businessId: session.businessId } },
    select: { role: true, user: { select: { isActive: true } } }
  });
  if (!membership || !membership.user.isActive) return null;

  return {
    userId: session.userId,
    businessId: session.businessId,
    role: normalizeRole(membership.role),
    sessionId: session.sessionId
  };
};

/**
 * Who is signed in and which business they are in, without judging the
 * request. For server components and for reads; anything that changes data
 * must go through requireAuthContext().
 */
export const getAuthContext = async (): Promise<AuthContext | null> => {
  const info = await getRequestInfo();
  return resolveAuthContext(info.sessionToken);
};

/** Throws ForbiddenError when this role may not make this request. */
export const assertRequestAllowed = (ctx: Pick<AuthContext, "role">, info: Pick<RequestInfo, "method" | "pathname">) => {
  const denial = checkAccess(ctx.role, info.method, info.pathname);
  if (denial) throw new ForbiddenError(denial);
};

/**
 * Use inside route handlers. Throws UnauthorizedError when not signed in and
 * ForbiddenError when the role does not allow the request:
 *  - a viewer may only GET/HEAD (plus a short list of own-account requests);
 *  - an accountant may not write to the owner-only paths;
 *  - if the method cannot be verified (the request did not pass the proxy),
 *    only an owner is let through.
 * Every handler that calls this is covered, including ones added later.
 */
export const requireAuthContext = async (): Promise<AuthContext> => {
  const info = await getRequestInfo();
  const ctx = await resolveAuthContext(info.sessionToken);
  if (!ctx) throw new UnauthorizedError();
  assertRequestAllowed(ctx, info);
  return ctx;
};

/** requireAuthContext() plus: the member must hold one of these roles. */
export const requireRole = async (...roles: Role[]): Promise<AuthContext> => {
  const ctx = await requireAuthContext();
  if (!roles.includes(ctx.role)) {
    throw new ForbiddenError(roles.length === 1 && roles[0] === Roles.OWNER ? "owner_only" : "role");
  }
  return ctx;
};

/** For member management, invitations, billing and the identity of the business. */
export const requireOwner = () => requireRole(Roles.OWNER);

/** Owner or accountant: anyone who may change the books. */
export const requireBookkeeper = () => requireRole(Roles.OWNER, Roles.ACCOUNTANT);

// ─── The signed-in person, whatever business they are in ─────────────────────

export type UserContext = {
  userId: string;
  email: string;
  fullName: string | null;
  sessionId: string;
  /** The business the session points at; may be one the person no longer belongs to. */
  sessionBusinessId: string;
};

/**
 * The signed-in person without requiring a membership. Only for things a
 * person does for themselves: listing and switching their businesses,
 * accepting an invitation. Never use it to read or write a business's data.
 */
export const getUserContext = async (): Promise<UserContext | null> => {
  const { sessionToken } = await getRequestInfo();
  if (!sessionToken) return null;
  const session = await sessionForToken(sessionToken);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, fullName: true, isActive: true }
  });
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    sessionId: session.sessionId,
    sessionBusinessId: session.businessId
  };
};

// ─── Turning the errors into responses ────────────────────────────────────────

/** A 401/403 JSON response for an auth error; null for any other error. */
export const authErrorResponse = (error: unknown, locale?: string | null): NextResponse | null => {
  if (error instanceof ForbiddenError) {
    const message = error.code === "role" ? error.message : denialMessage(error.code, locale);
    return NextResponse.json(
      { error: message, code: error.code },
      { status: 403, headers: { [ACCESS_DENIED_HEADER]: error.code } }
    );
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
  }
  return null;
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
