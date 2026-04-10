import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  AUTH_INDICATOR_COOKIE,
  createSession,
  findUserByEmail,
  getUserBusinessId,
  verifyUserCredentials
} from "@/lib/auth/session";
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

    const businessId = await getUserBusinessId(user.id);
    if (!businessId) {
      return NextResponse.json({ error: "No business found for this account." }, { status: 403 });
    }

    const token = await createSession(user.id, businessId);

    const response = NextResponse.json({ ok: true, userId: user.id });
    const cookieOpts = {
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
    };
    response.cookies.set(AUTH_COOKIE_NAME, token, { ...cookieOpts, httpOnly: true });
    response.cookies.set(AUTH_INDICATOR_COOKIE, "1", { ...cookieOpts, httpOnly: false });

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
