import { createHash } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { findUserByEmail, hashPassword } from "@/lib/auth/session";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

const schema = z.object({
  token: z.string().min(1),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128)
});

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `reset-password:${ip}`, limit: 10, windowSeconds: 900 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Validation error." }, { status: 422 });
  }

  const { token, email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  if (!user.passwordResetToken || !user.passwordResetExpiresAt) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  if (user.passwordResetExpiresAt < new Date()) {
    return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
  }

  const tokenHash = hashResetToken(token);
  if (tokenHash !== user.passwordResetToken) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null
    }
  });

  // Invalidate all existing sessions so the user must log in fresh
  await prisma.session.deleteMany({ where: { userId: user.id } });

  return NextResponse.json({ ok: true });
}
