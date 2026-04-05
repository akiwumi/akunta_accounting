import { cookies } from "next/headers";

export const SUPPORTED_LOCALES = ["en", "sv"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: string | undefined | null): value is Locale =>
  value === "en" || value === "sv";

export const getRequestLocale = (): Locale => {
  const cookieLocale = cookies().get("locale")?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
};
