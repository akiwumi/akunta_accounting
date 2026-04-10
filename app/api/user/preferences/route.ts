import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

// GET /api/user/preferences
export async function GET() {
  let ctx;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { hintsEnabled: true, cookieConsent: true }
  });

  return NextResponse.json({
    hintsEnabled: user?.hintsEnabled ?? true,
    cookieConsent: user?.cookieConsent ?? null
  });
}

// PUT /api/user/preferences
export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireAuthContext();
  } catch {
    // Return 200 for cookie consent saves even when not authenticated
    // (cookie is already set client-side; this is just a best-effort DB sync)
    return NextResponse.json({ ok: true });
  }

  let payload: { hintsEnabled?: unknown; cookieConsent?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: { hintsEnabled?: boolean; cookieConsent?: string } = {};

  if (typeof payload.hintsEnabled === "boolean") {
    data.hintsEnabled = payload.hintsEnabled;
  }
  if (payload.cookieConsent === "all" || payload.cookieConsent === "essential") {
    data.cookieConsent = payload.cookieConsent;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: ctx.userId }, data });

  return NextResponse.json({ ok: true });
}
