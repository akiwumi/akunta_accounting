/**
 * POST /api/session/switch   { businessId }
 *
 * Moves the current session to another of the person's businesses. The
 * business is only accepted if the person is a member of it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserContext } from "@/lib/auth/context";
import { setBusinessCookies } from "@/lib/auth/cookies";
import { currentSessionToken, readJson } from "@/lib/auth/http";
import { getRequestLocale } from "@/lib/i18n/locale";
import { switchSessionBusiness } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ businessId: z.string().trim().min(1).max(64) });

export async function POST(request: Request) {
  const user = await getUserContext();
  const token = await currentSessionToken();
  if (!user || !token) return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "businessId is required." }, { status: 422 });

  const switched = await switchSessionBusiness({
    sessionId: user.sessionId,
    userId: user.userId,
    businessId: parsed.data.businessId
  });
  if (!switched) {
    const locale = await getRequestLocale();
    return NextResponse.json(
      { error: locale === "sv" ? "Du har inte åtkomst till det företaget." : "You do not have access to that business." },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ ok: true, businessId: switched.businessId, role: switched.role });
  await setBusinessCookies(response, token, switched);
  return response;
}
