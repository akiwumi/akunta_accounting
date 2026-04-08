import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createSession,
  getUserBusinessId
} from "@/lib/auth/session";
import { getSupabaseUserForAccessToken } from "@/lib/auth/supabase";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const completeSupabaseSchema = z.object({
  accessToken: z.string().trim().min(20)
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = completeSupabaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing Supabase access token." }, { status: 400 });
  }

  try {
    const supabaseUser = await getSupabaseUserForAccessToken(parsed.data.accessToken);
    const email = supabaseUser?.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Supabase confirmation did not include an email address." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { take: 1 } }
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "No matching account was found for this confirmation." }, { status: 404 });
    }

    if (!user.emailVerifiedAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          emailVerificationToken: null
        }
      });
    }

    const businessId = user.memberships[0]?.businessId ?? (await getUserBusinessId(user.id));
    if (!businessId) {
      return NextResponse.json({ error: "Account setup is incomplete. Please contact support." }, { status: 409 });
    }

    const sessionToken = await createSession(user.id, businessId);
    const response = NextResponse.json({
      ok: true,
      firstName: user.fullName?.split(" ")[0] ?? "there"
    });

    response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
    });

    return response;
  } catch (error) {
    console.error("Supabase confirmation completion failed:", error);
    return NextResponse.json(
      { error: "We couldn't complete your email confirmation. Please try the link again." },
      { status: 500 }
    );
  }
}
