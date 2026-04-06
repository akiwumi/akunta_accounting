import { NextResponse } from "next/server";

import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  AUTH_SESSION_TOKEN,
  verifyLoginCredentials
} from "@/lib/auth/session";

type LoginPayload = {
  username?: unknown;
  password?: unknown;
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export async function POST(request: Request) {
  let payload: LoginPayload = {};
  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = asString(payload.username);
  const password = asString(payload.password);

  if (!verifyLoginCredentials(username, password)) {
    return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, AUTH_SESSION_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });

  return response;
}
