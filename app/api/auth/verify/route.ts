/**
 * GET /api/auth/verify?token=<hex>
 *
 * Confirms an email address, starts a session, and redirects to /welcome.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME } from "@/lib/auth/session";
import { verifyEmailToken } from "@/lib/auth/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verificationBodySchema = z.object({
  token: z.string().trim().min(32)
});

function setAuthCookie(response: NextResponse, sessionToken: string) {
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token") ?? "";

  const result = await verifyEmailToken(token);
  if (!result.ok) {
    const path = result.code === "no_business" ? "/login?error=no_business" : "/login?error=invalid_token";
    return NextResponse.redirect(new URL(path, origin));
  }

  const response = NextResponse.redirect(new URL("/welcome?confirmed=1", origin));
  setAuthCookie(response, result.sessionToken);
  return response;
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
  setAuthCookie(response, result.sessionToken);
  return response;
}
