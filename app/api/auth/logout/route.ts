import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, AUTH_INDICATOR_COOKIE, deleteSession } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (token) await deleteSession(token);

  const response = NextResponse.json({ ok: true });
  const clearOpts = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
  response.cookies.set(AUTH_COOKIE_NAME, "", { ...clearOpts, httpOnly: true });
  response.cookies.set(AUTH_INDICATOR_COOKIE, "", { ...clearOpts, httpOnly: false });
  return response;
}
