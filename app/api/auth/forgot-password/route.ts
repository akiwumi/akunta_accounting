import { createHash, randomBytes } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
import { prisma } from "@/lib/db";
import { findUserByEmail } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254)
});

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const from = getDefaultEmailFromAddress();
  const subject = "Reset your Akunta password";

  const html = `
    <div style="margin:0;background:#f5f2eb;padding:32px 16px;font-family:Arial,sans-serif;color:#203033">
      <div style="max-width:600px;margin:0 auto;background:#fffaf4;border:1px solid #e7dfd2;border-radius:24px;padding:36px 32px;box-shadow:0 18px 48px rgba(54,66,68,0.08)">
        <p style="margin:0 0 8px;color:#6b7a7d;font-size:13px;letter-spacing:0.08em;text-transform:uppercase">Akunta</p>
        <h1 style="margin:0 0 14px;font-size:28px;line-height:1.15;color:#243336">Reset your password</h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#47585b">
          We received a request to reset the password for your Akunta account.
          Click the button below to set a new password. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}"
          style="display:inline-block;padding:14px 24px;background:#364244;color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px">
          Reset password
        </a>
        <div style="margin:28px 0 0;padding:18px 20px;background:#f3efe6;border-radius:18px;color:#5b686b;font-size:14px;line-height:1.7">
          <strong style="color:#243336">Direct link</strong><br />
          <a href="${resetUrl}" style="color:#364244;word-break:break-all">${resetUrl}</a>
        </div>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#718083">
          If you didn&apos;t request a password reset, you can ignore this email. Your password will not change.
        </p>
      </div>
    </div>
  `;

  const text = [
    "Reset your Akunta password",
    "",
    "We received a request to reset the password for your account.",
    "Click the link below to set a new password (expires in 1 hour):",
    resetUrl,
    "",
    "If you didn't request a password reset, you can ignore this email."
  ].join("\n");

  if (isResendConfigured()) {
    try {
      await sendEmailViaResend({ from, to: email, subject, html, text });
      return;
    } catch (err) {
      logger.warn("auth.forgot_password.resend_failed", { email, error: String(err) });
    }
  }

  const smtp = getSmtpConfig();
  if (smtp.ok) {
    const transporter = createSmtpTransport(smtp.config);
    try {
      await transporter.sendMail({ from, to: email, subject, html, text });
    } catch (err) {
      logger.error("auth.forgot_password.smtp_failed", { email, error: String(err) });
    }
  } else {
    logger.error("auth.forgot_password.no_provider", { email, missing: smtp.missing });
    if (process.env.NODE_ENV !== "production") {
      console.info(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    }
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `forgot-password:${ip}`, limit: 5, windowSeconds: 900 });
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
    return NextResponse.json({ error: "A valid email address is required." }, { status: 422 });
  }

  const { email } = parsed.data;
  const user = await findUserByEmail(email);

  // Always return 200 to avoid user enumeration
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: true });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: tokenHash, passwordResetExpiresAt: expiresAt }
  });

  await sendPasswordResetEmail(email, token);

  return NextResponse.json({ ok: true });
}
