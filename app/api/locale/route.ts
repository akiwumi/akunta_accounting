import { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locale";

const schema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE)
});

export async function POST(request: Request) {
  const payload = schema.parse(await request.json());

  const response = NextResponse.json({ ok: true, locale: payload.locale });
  response.cookies.set("locale", payload.locale as Locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax"
  });

  return response;
}
