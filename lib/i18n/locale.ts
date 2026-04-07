import { cookies, headers } from "next/headers";

export const SUPPORTED_LOCALES = ["en", "sv"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: string | undefined | null): value is Locale =>
  value === "en" || value === "sv";

/**
 * Maps Accept-Language primary tags to supported Akunta locales.
 * Only tags that map to a supported locale are included.
 */
const ACCEPT_LANGUAGE_TO_LOCALE: Record<string, Locale> = {
  sv: "sv",
  "sv-se": "sv"
};

/**
 * Parse the first matching supported locale from an Accept-Language header.
 * Returns null if no match found.
 */
export function parseAcceptLanguage(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;

  const tags = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    if (ACCEPT_LANGUAGE_TO_LOCALE[tag]) return ACCEPT_LANGUAGE_TO_LOCALE[tag];
    const base = tag.split("-")[0];
    if (base && ACCEPT_LANGUAGE_TO_LOCALE[base]) return ACCEPT_LANGUAGE_TO_LOCALE[base];
  }

  return null;
}

/**
 * Resolve the active locale for a server request.
 *
 * Priority:
 *  1. "locale" cookie (explicit user selection — sticky across sessions)
 *  2. Accept-Language header (browser/OS preference — first visit)
 *  3. DEFAULT_LOCALE ("en")
 */
export const getRequestLocale = (): Locale => {
  // 1. Cookie
  const cookieLocale = cookies().get("locale")?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  // 2. Accept-Language header
  try {
    const acceptLanguage = headers().get("accept-language");
    const detected = parseAcceptLanguage(acceptLanguage);
    if (detected) return detected;
  } catch {
    // headers() may throw outside a request context (e.g. during static generation)
  }

  // 3. Default
  return DEFAULT_LOCALE;
};
