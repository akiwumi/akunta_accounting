/**
 * GET /api/auth/verify?token=<hex>
 *
 * Confirms an email address, starts a session, and redirects to /welcome.
 */

import { NextResponse } from "next/server";

import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || token.length < 32) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", origin));
  }

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
    include: { memberships: { take: 1 } }
  });

  if (!user) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", origin));
  }

  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationToken: null }
    });
  }

  const businessId = user.memberships[0]?.businessId;
  if (!businessId) {
    return NextResponse.redirect(new URL("/login?error=no_business", origin));
  }

  const sessionToken = await createSession(user.id, businessId);

  const response = NextResponse.redirect(new URL("/welcome", origin));
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });
  return response;
}
