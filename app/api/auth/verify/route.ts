/**
 * GET /api/auth/verify?token=<hex>
 *
 * Confirms an email address, starts a session, and redirects to /welcome.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, AUTH_INDICATOR_COOKIE } from "@/lib/auth/session";
import { verifyEmailToken } from "@/lib/auth/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verificationBodySchema = z.object({
  token: z.string().trim().min(32)
});

function setAuthCookies(response: NextResponse, sessionToken: string) {
  const base = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  };
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, { ...base, httpOnly: true });
  response.cookies.set(AUTH_INDICATOR_COOKIE, "1", { ...base, httpOnly: false });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const path = token ? `/welcome?token=${encodeURIComponent(token)}` : "/login?error=invalid_token";
  return NextResponse.redirect(new URL(path, origin));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = verificationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid or expired confirmation link." }, { status: 400 });
  }

  const result = await verifyEmailToken(parsed.data.token);
  if (!result.ok) {
    const error =
      result.code === "no_business"
        ? "Account setup is incomplete. Please contact support."
        : "Invalid or expired confirmation link.";
    const status = result.code === "no_business" ? 409 : 400;
    return NextResponse.json({ error }, { status });
  }

  const response = NextResponse.json({ ok: true, firstName: result.firstName });
  setAuthCookies(response, result.sessionToken);
  return response;
}
