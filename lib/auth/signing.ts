// HMAC helpers shared by the proxy and the route handlers. Web Crypto only, so
// the file is safe to import from proxy.ts.
//
// Two things are signed:
//  1. The request line (method + pathname) the proxy forwards to the app. A
//     client cannot forge it, so a request that somehow skipped the proxy is
//     treated as "method unknown" and a non-owner is refused.
//  2. A short-lived role cookie, which lets the proxy answer a read-only member
//     with a clean 403 before the handler runs. It can only ever cause a
//     refusal; the database check in lib/auth/context.ts decides what is allowed.

import { isRole, type Role } from "@/lib/auth/roles";

export const REQUEST_METHOD_HEADER = "x-akunta-method";
export const REQUEST_SIGNATURE_HEADER = "x-akunta-request-sig";
export const REQUEST_PATH_HEADER = "x-pathname";

export const ACCESS_COOKIE_NAME = "akunta_access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const encoder = new TextEncoder();

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

const getKey = () => {
  // Same secret (and the same fallback) as the session token hash.
  // A public default would let anyone compute session hashes and request
  // signatures, so production refuses to run without its own secret.
  if (!process.env.SESSION_SALT?.trim() && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SALT must be set in production.");
  }
  const secret = process.env.SESSION_SALT?.trim() || "akunta-session-salt";
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    };
  }
  return cachedKey.key;
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hmacHex = async (message: string) => toHex(await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(message)));

const sha256Hex = async (value: string) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// ─── Request line ─────────────────────────────────────────────────────────────

const requestMessage = (method: string, pathname: string) => `request\n${method.toUpperCase()}\n${pathname}`;

export const signRequestLine = (method: string, pathname: string) => hmacHex(requestMessage(method, pathname));

export const verifyRequestLine = async (
  method: string | null | undefined,
  pathname: string | null | undefined,
  signature: string | null | undefined
) => {
  if (!method || !pathname || !signature) return false;
  return constantTimeEqual(await signRequestLine(method, pathname), signature);
};

// ─── Role cookie ──────────────────────────────────────────────────────────────

const roleMessage = (sessionDigest: string, role: string, businessId: string, expiresAt: number) =>
  `role\n${sessionDigest}\n${role}\n${businessId}\n${expiresAt}`;

/** Value for the role cookie, bound to this session token so it cannot be moved to another session. */
export const signAccessCookie = async (sessionToken: string, role: Role, businessId: string) => {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_COOKIE_MAX_AGE_SECONDS;
  const signature = await hmacHex(roleMessage(await sha256Hex(sessionToken), role, businessId, expiresAt));
  return `${role}.${businessId}.${expiresAt}.${signature}`;
};

/** The role in a valid, unexpired cookie for this session token; null for anything else. */
export const readAccessCookie = async (
  cookieValue: string | null | undefined,
  sessionToken: string | null | undefined
): Promise<{ role: Role; businessId: string } | null> => {
  if (!cookieValue || !sessionToken) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 4) return null;
  const [role, businessId, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!isRole(role) || !businessId || !Number.isInteger(expiresAt)) return null;
  if (expiresAt * 1000 < Date.now()) return null;
  const expected = await hmacHex(roleMessage(await sha256Hex(sessionToken), role, businessId, expiresAt));
  return constantTimeEqual(expected, signature) ? { role, businessId } : null;
};
