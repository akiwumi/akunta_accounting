import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

// POST /api/settings/locale — persists the user's locale choice to Business.locale in DB
// and echoes it back as a cookie so the UI updates immediately on the next render.
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { locale?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const locale = payload.locale;
  if (locale !== "en" && locale !== "sv") {
    return NextResponse.json({ error: "Invalid locale. Must be 'en' or 'sv'." }, { status: 400 });
  }

  await prisma.business.update({
    where: { id: ctx.businessId },
    data: { locale }
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false
  });

  return response;
}
