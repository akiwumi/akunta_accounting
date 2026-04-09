import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

import { prisma } from "@/lib/db";

export { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/constants";
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
