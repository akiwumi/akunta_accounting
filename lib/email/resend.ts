export type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendEmailViaResend(payload: EmailPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  // Dynamic import prevents the Resend SDK from initialising Headers at build time,
  // which would fail Next.js's static page-data collection step.
  const { Resend } = await import("resend");
  const resend = new Resend(key);

  const { error } = await resend.emails.send({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType
    }))
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
