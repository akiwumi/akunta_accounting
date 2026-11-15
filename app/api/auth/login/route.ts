import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import { setBusinessCookies, setSessionCookies } from "@/lib/auth/cookies";
import {
  createSession,
  findUserByEmail,
  LAST_BUSINESS_COOKIE,
  NO_BUSINESS_ID,
  pickLoginBusinessId,
  verifyUserCredentials
} from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `login:${ip}`, limit: 10, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) }
      }
    );
  }
  let payload: { email?: unknown; username?: unknown; password?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const emailSource = typeof payload.email === "string"
    ? payload.email
    : typeof payload.username === "string"
      ? payload.username
      : "";
  const email = emailSource.trim();
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  try {
    const existingUser = await findUserByEmail(email);
    if (existingUser && !existingUser.emailVerifiedAt) {
      return NextResponse.json(
        { error: "Please confirm your email address before signing in." },
        { status: 403 }
      );
    }

    const user = await verifyUserCredentials(email, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 });
    }

    // The business last worked in if the person still belongs to it, otherwise
    // their first. The cookie is only a hint and is checked against their own
    // memberships. Someone with no membership at all still gets a session, in
    // no business, and lands on the page that explains it.
    const lastUsed = (await cookies()).get(LAST_BUSINESS_COOKIE)?.value ?? null;
    const businessId = await pickLoginBusinessId(user.id, lastUsed);

    const membership = businessId
      ? await prisma.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { role: true, business: { select: { locale: true } } }
        })
      : null;

    const token = await createSession(user.id, membership && businessId ? businessId : NO_BUSINESS_ID);

    const response = NextResponse.json({ ok: true, userId: user.id, hasBusiness: Boolean(membership) });
    setSessionCookies(response, token);
    await setBusinessCookies(response, token, membership && businessId ? { businessId, role: membership.role } : null);
    if (membership) {
      // Business locale as the starting language, unless the person already chose one.
      const chosen = (await cookies()).get("locale")?.value;
      if (chosen !== "en" && chosen !== "sv") {
        response.cookies.set("locale", membership.business.locale ?? "en", {
          sameSite: "lax" as const,
          secure: process.env.NODE_ENV === "production",
          path: "/",
          httpOnly: false,
          maxAge: 60 * 60 * 24 * 365
        });
      }
    }

    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      console.error("Login database initialization failed:", error);
      return NextResponse.json(
        { error: "Sign in is temporarily unavailable. Please try again shortly." },
        { status: 503 }
      );
    }

    console.error("Login request failed:", error);
    return NextResponse.json(
      { error: "Sign in failed. Please try again." },
      { status: 500 }
    );
  }
}
