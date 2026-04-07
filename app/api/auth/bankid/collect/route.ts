/**
 * POST /api/auth/bankid/collect
 *
 * Polls a BankID order and, when complete, provisions or resolves the user,
 * creates an app session, and sets the auth cookie.
 *
 * The client should poll every 2 seconds with the orderRef from /start.
 *
 * Body:
 *   { orderRef: string }
 *
 * Responses:
 *   200 { status: "pending", hintCode?: string }
 *   200 { status: "complete", ok: true, userId, businessId, isNewUser }
 *   200 { status: "failed",   hintCode?: string }
 *   400  invalid body
 *   502  upstream error
 */

import { NextResponse } from "next/server";

import { bankIdCollect } from "@/lib/integrations/bankid/client";
import { resolveOrProvisionBankIdUser } from "@/lib/integrations/bankid/auth";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  // Allow frequent polling (client polls every 2 s, cap at 60/min)
  const rl = rateLimit({ key: `bankid-collect:${ip}`, limit: 60, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) },
      }
    );
  }

  let orderRef: string;
  try {
    const body = (await request.json()) as { orderRef?: unknown };
    if (typeof body.orderRef !== "string" || !body.orderRef.trim()) {
      return NextResponse.json({ error: "orderRef is required." }, { status: 400 });
    }
    orderRef = body.orderRef.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let collected;
  try {
    collected = await bankIdCollect(orderRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : "BankID service unavailable.";
    if (message.includes("not configured")) {
      return NextResponse.json({ error: "BankID is not enabled on this server." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not collect BankID status." }, { status: 502 });
  }

  if (collected.status === "pending") {
    return NextResponse.json({ status: "pending", hintCode: collected.hintCode });
  }

  if (collected.status === "failed") {
    return NextResponse.json({ status: "failed", hintCode: collected.hintCode });
  }

  // status === "complete"
  const completionData = collected.completionData;
  if (!completionData) {
    return NextResponse.json({ error: "BankID complete but no completionData returned." }, { status: 502 });
  }

  const { personalNumber, name } = completionData.user;

  let session;
  try {
    session = await resolveOrProvisionBankIdUser(personalNumber, name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "User provisioning failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const response = NextResponse.json({
    status: "complete",
    ok: true,
    userId: session.userId,
    businessId: session.businessId,
    isNewUser: session.isNewUser,
  });

  response.cookies.set(session.cookieName, session.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.cookieMaxAge,
  });

  return response;
}
