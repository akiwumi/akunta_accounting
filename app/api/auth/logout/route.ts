import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { clearSessionCookies } from "@/lib/auth/cookies";
import { AUTH_COOKIE_NAME, deleteSession } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (token) await deleteSession(token);

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
