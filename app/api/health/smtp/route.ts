import { NextResponse } from "next/server";

import { createSmtpTransport, getSmtpConfig } from "@/lib/email/smtp";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/smtp
 *
 * Tests SMTP connectivity and authentication.
 * Useful for diagnosing email delivery failures.
 * Remove or restrict after debugging.
 */
export async function GET() {
  const smtp = getSmtpConfig();

  if (!smtp.ok) {
    return NextResponse.json(
      { ok: false, stage: "config", error: smtp.error, missing: smtp.missing },
      { status: 503 }
    );
  }

  const { host, port, secure, requireTLS, user } = smtp.config;

  try {
    const transporter = createSmtpTransport(smtp.config);
    await transporter.verify();

    return NextResponse.json({
      ok: true,
      host,
      port,
      secure,
      requireTLS,
      user
    });
  } catch (err) {
    const e = err as Error & {
      code?: string;
      command?: string;
      response?: string;
      responseCode?: number;
      syscall?: string;
      address?: string;
    };

    return NextResponse.json(
      {
        ok: false,
        stage: "connect",
        host,
        port,
        secure,
        requireTLS,
        user,
        error: e.message,
        code: e.code,
        responseCode: e.responseCode,
        response: e.response,
        command: e.command,
        syscall: e.syscall,
        address: e.address
      },
      { status: 503 }
    );
  }
}
