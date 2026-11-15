import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * Scheduled jobs are called with "Authorization: Bearer <CRON_SECRET>" (this
 * is what Vercel Cron sends when CRON_SECRET is set). Without the variable
 * the job refuses to run at all, so it can never be open by accident.
 * Returns a response to send back when the caller is not allowed, else null.
 */
export const cronAuthFailure = (request: Request): NextResponse | null => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
};
