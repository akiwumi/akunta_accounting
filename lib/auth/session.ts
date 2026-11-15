import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

import { prisma } from "@/lib/db";

export { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_INDICATOR_COOKIE } from "@/lib/auth/constants";
import { AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/constants";

const scryptAsync = promisify(scrypt);

// ─── Password hashing (scrypt) ────────────────────────────────────────────────

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    const [salt, storedKey] = hash.split(":");
    if (!salt || !storedKey) return false;
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const storedBuffer = Buffer.from(storedKey, "hex");
    return timingSafeEqual(derivedKey, storedBuffer);
  } catch {
    return false;
  }
};

// ─── Session token ────────────────────────────────────────────────────────────

export const generateSessionToken = () => randomBytes(32).toString("hex");

export const hashToken = async (token: string): Promise<string> => {
  // A public default would let anyone compute session hashes and request
  // signatures, so production refuses to run without its own secret.
  if (!process.env.SESSION_SALT?.trim() && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SALT must be set in production.");
  }
  const salt = process.env.SESSION_SALT?.trim() || "akunta-session-salt";
  const key = (await scryptAsync(token, salt, 32)) as Buffer;
  return key.toString("hex");
};

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export type SessionData = {
  sessionId: string;
  userId: string;
  businessId: string;
};

export const createSession = async (userId: string, businessId: string): Promise<string> => {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + AUTH_COOKIE_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: { userId, businessId, tokenHash, expiresAt }
  });

  return token;
};

export const getSessionByToken = async (token: string): Promise<SessionData | null> => {
  if (!token) return null;
  try {
    const tokenHash = await hashToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash }
    });
    if (!session || session.expiresAt < new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      return null;
    }
    return { sessionId: session.id, userId: session.userId, businessId: session.businessId };
  } catch {
    return null;
  }
};

export const deleteSession = async (token: string): Promise<void> => {
  try {
    const tokenHash = await hashToken(token);
    await prisma.session.deleteMany({ where: { tokenHash } });
  } catch {
    // ignore
  }
};

export const deleteAllUserSessions = async (userId: string): Promise<void> => {
  await prisma.session.deleteMany({ where: { userId } });
};

// ─── User auth ────────────────────────────────────────────────────────────────

export const findUserByEmail = async (email: string) =>
  prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

export const verifyUserCredentials = async (email: string, password: string) => {
  const user = await findUserByEmail(email);
  if (!user || !user.isActive || !user.passwordHash) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  return valid ? user : null;
};

export const getUserBusinessId = async (userId: string): Promise<string | null> => {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });
  return membership?.businessId ?? null;
};

// ─── Several businesses per person ────────────────────────────────────────────

/**
 * Session.businessId for a signed-in person who is not a member of any
 * business (for example after being removed from their only one). It matches
 * no business, so getAuthContext() returns null and pages send them to the
 * "no access" page instead of an error.
 */
export const NO_BUSINESS_ID = "";

/** Remembers the business a person last worked in. Only a hint: it is checked against their memberships. */
export const LAST_BUSINESS_COOKIE = "akunta_business";

export const listUserBusinesses = async (userId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, createdAt: true, business: { select: { id: true, name: true, locale: true } } }
  });
  return memberships.map((m) => ({
    id: m.business.id,
    name: m.business.name,
    locale: m.business.locale,
    role: m.role,
    memberSince: m.createdAt
  }));
};

/**
 * The business a new session starts in: the one last used if the person is
 * still a member of it, otherwise their oldest membership. Null when they
 * have none. `preferredBusinessId` comes from a cookie and is never trusted
 * beyond "pick this one of my own memberships".
 */
export const pickLoginBusinessId = async (userId: string, preferredBusinessId?: string | null): Promise<string | null> => {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { businessId: true }
  });
  if (memberships.length === 0) return null;
  const own = new Set(memberships.map((m) => m.businessId));
  if (preferredBusinessId && own.has(preferredBusinessId)) return preferredBusinessId;

  const lastSession = await prisma.session.findFirst({
    where: { userId, businessId: { in: [...own] } },
    orderBy: { createdAt: "desc" },
    select: { businessId: true }
  });
  return lastSession?.businessId ?? memberships[0].businessId;
};

/**
 * Points an existing session at another business. Refused (null) unless the
 * session belongs to this user and the user is a member of that business.
 */
export const switchSessionBusiness = async (params: {
  sessionId: string;
  userId: string;
  businessId: string;
}): Promise<{ businessId: string; role: string } | null> => {
  if (!params.businessId) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: params.userId, businessId: params.businessId } },
    select: { role: true }
  });
  if (!membership) return null;

  const updated = await prisma.session.updateMany({
    where: { id: params.sessionId, userId: params.userId },
    data: { businessId: params.businessId }
  });
  if (updated.count !== 1) return null;
  return { businessId: params.businessId, role: membership.role };
};
