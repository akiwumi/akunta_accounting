// Cookie handling for sessions, in one place so every sign-in path sets the
// same cookies with the same flags.

import { type NextResponse } from "next/server";

import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, AUTH_INDICATOR_COOKIE } from "@/lib/auth/constants";
import { normalizeRole } from "@/lib/auth/roles";
import { LAST_BUSINESS_COOKIE } from "@/lib/auth/session";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, signAccessCookie } from "@/lib/auth/signing";

const base = () => ({
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/"
});

export const setSessionCookies = (response: NextResponse, sessionToken: string) => {
  const opts = { ...base(), maxAge: AUTH_COOKIE_MAX_AGE_SECONDS };
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, { ...opts, httpOnly: true });
  response.cookies.set(AUTH_INDICATOR_COOKIE, "1", { ...opts, httpOnly: false });
};

/**
 * Records which business the session is in: the signed role cookie the proxy
 * reads, and the "last used business" hint for the next sign-in. Pass null
 * when the person has no business.
 */
export const setBusinessCookies = async (
  response: NextResponse,
  sessionToken: string,
  access: { businessId: string; role: string } | null
) => {
  if (!access) {
    response.cookies.set(ACCESS_COOKIE_NAME, "", { ...base(), httpOnly: true, maxAge: 0 });
    return;
  }
  response.cookies.set(
    ACCESS_COOKIE_NAME,
    await signAccessCookie(sessionToken, normalizeRole(access.role), access.businessId),
    { ...base(), httpOnly: true, maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS }
  );
  response.cookies.set(LAST_BUSINESS_COOKIE, access.businessId, {
    ...base(),
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365
  });
};

export const clearSessionCookies = (response: NextResponse) => {
  const opts = { ...base(), maxAge: 0 };
  response.cookies.set(AUTH_COOKIE_NAME, "", { ...opts, httpOnly: true });
  response.cookies.set(AUTH_INDICATOR_COOKIE, "", { ...opts, httpOnly: false });
  response.cookies.set(ACCESS_COOKIE_NAME, "", { ...opts, httpOnly: true });
};
