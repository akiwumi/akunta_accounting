// Small helpers for the access, member and invitation route handlers.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { authErrorResponse } from "@/lib/auth/context";
import { TeamError } from "@/lib/auth/members";
import { getRequestLocale } from "@/lib/i18n/locale";
import { type RateLimitResult } from "@/lib/security/rateLimit";

export const currentSessionToken = async () => (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;

/** Maps auth and team errors to a JSON response in the person's language. Anything else is logged and becomes a 500. */
export const accessErrorResponse = async (error: unknown, scope: string) => {
  const locale = await getRequestLocale().catch(() => "en" as const);
  const auth = authErrorResponse(error, locale);
  if (auth) return auth;
  if (error instanceof TeamError) {
    return NextResponse.json({ error: error.localized(locale), code: error.code }, { status: error.status });
  }
  console.error(`${scope} failed:`, error);
  return NextResponse.json(
    { error: locale === "sv" ? "Något gick fel. Försök igen." : "Something went wrong. Please try again." },
    { status: 500 }
  );
};

export const tooManyRequests = (rl: RateLimitResult, locale: string) =>
  NextResponse.json(
    {
      error:
        locale === "sv" ? "För många försök. Vänta en stund och försök igen." : "Too many attempts. Please wait a while and try again."
    },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000))) } }
  );

export const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};
