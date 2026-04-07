/**
 * POST /api/auth/bankid/start
 *
 * Initiates a BankID authentication order and returns the orderRef and
 * autoStartToken to the client. The client should open the BankID app using
 * the autoStartToken and then poll /api/auth/bankid/collect with the orderRef.
 *
 * Body (optional):
 *   { personalNumber?: string }  — pre-fill personal number if known
 */

import { NextResponse } from "next/server";

import { bankIdAuth } from "@/lib/integrations/bankid/client";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `bankid-start:${ip}`, limit: 20, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) },
      }
    );
  }

  let personalNumber: string | undefined;
  try {
    const body = (await request.json()) as { personalNumber?: unknown };
    if (typeof body.personalNumber === "string" && body.personalNumber.trim()) {
      personalNumber = body.personalNumber.trim().replace(/[-\s]/g, "");
    }
  } catch {
    // body is optional
  }

  try {
    const order = await bankIdAuth(ip, personalNumber);
    return NextResponse.json({
      orderRef: order.orderRef,
      autoStartToken: order.autoStartToken,
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "BankID service unavailable.";
    if (message.includes("not configured")) {
      return NextResponse.json({ error: "BankID is not enabled on this server." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not start BankID authentication." }, { status: 502 });
  }
}
