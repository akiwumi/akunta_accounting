import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

// GET /api/user/preferences — returns the authenticated user's stored preferences.
export async function GET() {
  let ctx;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { hintsEnabled: true }
  });

  return NextResponse.json({ hintsEnabled: user?.hintsEnabled ?? true });
}

// PUT /api/user/preferences — updates the authenticated user's stored preferences.
export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { hintsEnabled?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof payload.hintsEnabled !== "boolean") {
    return NextResponse.json({ error: "hintsEnabled must be a boolean." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: ctx.userId },
    data: { hintsEnabled: payload.hintsEnabled }
  });

  return NextResponse.json({ ok: true });
}
