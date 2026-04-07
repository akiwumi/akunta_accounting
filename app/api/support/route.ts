import { NextResponse } from "next/server";
import { z } from "zod";

import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger } from "@/lib/observability/logger";

const supportSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000)
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `support:${ip}`, limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many support requests. Please wait before submitting again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = supportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  const { name, email, subject, message } = parsed.data;

  // Log the support request — in production, swap this for email delivery
  // (e.g. via nodemailer to a support inbox) or a ticketing API call.
  logger.info("support.request.received", {
    name,
    email,
    subject,
    messageLength: message.length
  });

  // If SUPPORT_EMAIL is set, attempt to send via nodemailer
  if (process.env.SMTP_HOST && process.env.SUPPORT_EMAIL) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: `"Akunta Support Form" <${process.env.SMTP_USER ?? "noreply@akunta.app"}>`,
        replyTo: `"${name}" <${email}>`,
        to: process.env.SUPPORT_EMAIL,
        subject: `[Support] ${subject}`,
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`
      });

      logger.info("support.request.emailed", { email });
    } catch (err) {
      logger.error("support.request.email_failed", {
        error: err instanceof Error ? err.message : String(err)
      });
      // Don't surface email failures to the user — request is still logged
    }
  }

  return NextResponse.json({ ok: true });
}
