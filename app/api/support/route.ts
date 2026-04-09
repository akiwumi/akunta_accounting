import { NextResponse } from "next/server";
import { z } from "zod";

import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
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

  // Always log the support request so it is retained even if mail delivery fails.
  logger.info("support.request.received", {
    name,
    email,
    subject,
    messageLength: message.length
  });

  // Forward to support inbox if configured (non-fatal if it fails)
  const supportEmail = process.env.SUPPORT_EMAIL;
  if (supportEmail) {
    try {
      const emailText = `Name: ${name}\nEmail: ${email}\n\n${message}`;

      if (isResendConfigured()) {
        const from = process.env.EMAIL_FROM?.trim() ?? "Akunta <noreply@akunta.se>";
        await sendEmailViaResend({
          from,
          to: supportEmail,
          subject: `[Support] ${subject}`,
          html: `<p><strong>Name:</strong> ${name}<br/><strong>Email:</strong> ${email}</p><p>${message.replace(/\n/g, "<br/>")}</p>`,
          text: emailText
        });
      } else {
        const smtp = getSmtpConfig();
        if (smtp.ok) {
          const transporter = createSmtpTransport(smtp.config);
          await transporter.sendMail({
            from: getDefaultEmailFromAddress(`Akunta Support Form <${smtp.config.user}>`),
            replyTo: `"${name}" <${email}>`,
            to: supportEmail,
            subject: `[Support] ${subject}`,
            text: emailText
          });
        }
      }

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
