/**
 * One way to send an email with attachments: SMTP when it is configured,
 * otherwise Resend. Callers get a result instead of an exception when no
 * provider is set up, so they can explain it to the user.
 */

import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";

export type OutgoingEmail = {
  /** Preferred from address (the business setting). Falls back to the provider default. */
  from?: string | null;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export type SendEmailResult = { ok: true } | { ok: false; reason: "not_configured" | "failed"; message: string };

export const isEmailConfigured = () => getSmtpConfig().ok || isResendConfigured();

export const sendEmail = async (email: OutgoingEmail): Promise<SendEmailResult> => {
  const from = getDefaultEmailFromAddress(email.from?.trim() || undefined);
  const smtp = getSmtpConfig();

  try {
    if (smtp.ok) {
      await createSmtpTransport(smtp.config).sendMail({
        from,
        to: email.to,
        replyTo: email.replyTo?.trim() || undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments
      });
      return { ok: true };
    }

    if (isResendConfigured()) {
      await sendEmailViaResend({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments
      });
      return { ok: true };
    }
  } catch (error) {
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : "Email could not be sent." };
  }

  return {
    ok: false,
    reason: "not_configured",
    message: "Email delivery is not configured. Set SMTP credentials or RESEND_API_KEY."
  };
};

export const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Plain text as a simple, readable HTML email body. */
export const textToHtml = (text: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1c1e;line-height:1.55;font-size:15px;">${text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px;">${escapeHtml(paragraph).replaceAll("\n", "<br/>")}</p>`)
    .join("")}</div>`;
