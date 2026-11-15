/**
 * GET /api/session
 *
 * Who is signed in, which business the session is in, their role there, and
 * the other businesses they can switch to. The app shell reads it; it also
 * renews the signed role cookie the proxy uses.
 */

import { NextResponse } from "next/server";

import { getUserContext } from "@/lib/auth/context";
import { setBusinessCookies } from "@/lib/auth/cookies";
import { currentSessionToken } from "@/lib/auth/http";
import { normalizeRole } from "@/lib/auth/roles";
import { listUserBusinesses } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUserContext();
  const token = await currentSessionToken();
  if (!user || !token) return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });

  // Only the person's own memberships are ever listed.
  const businesses = (await listUserBusinesses(user.userId)).map((b) => ({
    id: b.id,
    name: b.name,
    role: normalizeRole(b.role)
  }));
  const current = businesses.find((b) => b.id === user.sessionBusinessId) ?? null;

  const response = NextResponse.json(
    { user: { email: user.email, fullName: user.fullName }, current, businesses },
    { headers: { "Cache-Control": "no-store" } }
  );
  await setBusinessCookies(response, token, current ? { businessId: current.id, role: current.role } : null);
  return response;
}
