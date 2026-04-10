import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

async function sendPasswordChangedNotification(email: string): Promise<void> {
  const from = getDefaultEmailFromAddress();
  const subject = "Your Akunta password was changed";

  const html = `
    <div style="margin:0;background:#f5f2eb;padding:32px 16px;font-family:Arial,sans-serif;color:#203033">
      <div style="max-width:600px;margin:0 auto;background:#fffaf4;border:1px solid #e7dfd2;border-radius:24px;padding:36px 32px;box-shadow:0 18px 48px rgba(54,66,68,0.08)">
        <p style="margin:0 0 8px;color:#6b7a7d;font-size:13px;letter-spacing:0.08em;text-transform:uppercase">Akunta</p>
        <h1 style="margin:0 0 14px;font-size:28px;line-height:1.15;color:#243336">Password changed</h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#47585b">
          The password for your Akunta account (<strong>${email}</strong>) was just changed.
        </p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#47585b">
          If you made this change, no action is needed.
          If you did not change your password, please reset it immediately.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/forgot-password"
          style="display:inline-block;padding:14px 24px;background:#364244;color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px">
          Reset password
        </a>
      </div>
    </div>
  `;

  const text = [
    "Password changed",
    "",
    `The password for your Akunta account (${email}) was just changed.`,
    "",
    "If you made this change, no action is needed.",
    "If you did not change your password, reset it here:",
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/forgot-password`
  ].join("\n");

  if (isResendConfigured()) {
    try {
      await sendEmailViaResend({ from, to: email, subject, html, text });
      return;
    } catch (err) {
      logger.warn("auth.change_password.notification_resend_failed", { email, error: String(err) });
    }
  }

  const smtp = getSmtpConfig();
  if (smtp.ok) {
    const transporter = createSmtpTransport(smtp.config);
    try {
      await transporter.sendMail({ from, to: email, subject, html, text });
    } catch (err) {
      logger.warn("auth.change_password.notification_smtp_failed", { email, error: String(err) });
    }
  }
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAuthContext>>;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Non-blocking notification email
  sendPasswordChangedNotification(user.email).catch(() => {});

  return NextResponse.json({ ok: true });
}
