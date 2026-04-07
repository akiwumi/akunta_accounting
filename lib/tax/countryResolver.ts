/**
 * Country resolution engine.
 *
 * Resolves the active country code for a business using the priority order
 * defined in the plan (section 16.11):
 *
 *  1. Explicit setting on Business.countryCode (user-selected in Settings)
 *  2. Captured at onboarding confirmation
 *  3. Billing country from Stripe customer (if available)
 *  4. Browser/OS locale inference (Accept-Language header)
 *  5. Unresolved — caller must prompt the user
 *
 * All resolution attempts that are not "explicit" are considered provisional.
 */

import { COUNTRY_PROFILES } from "@/lib/tax/profiles";

export type ResolutionSource =
  | "explicit"
  | "onboarding"
  | "stripe"
  | "locale"
  | "unresolved";

export type CountryResolution = {
  countryCode: string | null;
  source: ResolutionSource;
  /** True when the resolved country has a template in the registry */
  hasTemplate: boolean;
};

const LOCALE_TO_COUNTRY: Record<string, string> = {
  "sv": "SE",
  "sv-SE": "SE",
  "en-GB": "GB",
  "en-IE": "IE",
  "de": "DE",
  "de-DE": "DE",
  "de-AT": "AT",
  "de-CH": "DE", // no CH template yet; best-effort
  "de-LU": "LU",
  "fr": "FR",
  "fr-FR": "FR",
  "fr-BE": "BE",
  "fr-LU": "LU",
  "nl": "NL",
  "nl-NL": "NL",
  "nl-BE": "BE",
  "pl": "PL",
  "pl-PL": "PL",
  "fi": "FI",
  "fi-FI": "FI",
  "da": "DK",
  "da-DK": "DK",
  "es": "ES",
  "es-ES": "ES",
  "it": "IT",
  "it-IT": "IT",
  "pt": "PT",
  "pt-PT": "PT",
  "el": "GR",
  "el-GR": "GR",
  "cs": "CZ",
  "cs-CZ": "CZ",
  "sk": "SK",
  "sk-SK": "SK",
  "hu": "HU",
  "hu-HU": "HU",
  "ro": "RO",
  "ro-RO": "RO",
  "bg": "BG",
  "bg-BG": "BG",
  "hr": "HR",
  "hr-HR": "HR",
  "sl": "SI",
  "sl-SI": "SI",
  "et": "EE",
  "et-EE": "EE",
  "lv": "LV",
  "lv-LV": "LV",
  "lt": "LT",
  "lt-LT": "LT",
  "mt": "MT",
  "mt-MT": "MT",
  "el-CY": "CY"
};

/**
 * Resolve country from Accept-Language header value.
 * Returns null if no match.
 */
export function resolveCountryFromAcceptLanguage(acceptLanguage: string | null): string | null {
  if (!acceptLanguage) return null;

  // Parse quality-weighted language tags: "sv-SE,sv;q=0.9,en;q=0.8"
  const tags = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    // Try exact match first, then base language
    if (LOCALE_TO_COUNTRY[tag]) return LOCALE_TO_COUNTRY[tag];
    const base = tag.split("-")[0];
    if (base && LOCALE_TO_COUNTRY[base]) return LOCALE_TO_COUNTRY[base];
  }

  return null;
}

export type ResolveCountryOptions = {
  /** Persisted country on the Business record (may be null if never set) */
  persistedCountryCode?: string | null;
  /** Country captured at onboarding (passed through from the onboarding flow) */
  onboardingCountryCode?: string | null;
  /** Billing country from Stripe customer data */
  stripeCountryCode?: string | null;
  /** Value of the Accept-Language request header */
  acceptLanguage?: string | null;
};

export function resolveCountry(opts: ResolveCountryOptions): CountryResolution {
  const make = (countryCode: string | null, source: ResolutionSource): CountryResolution => ({
    countryCode,
    source,
    hasTemplate: countryCode !== null && countryCode in COUNTRY_PROFILES
  });

  if (opts.persistedCountryCode) return make(opts.persistedCountryCode.toUpperCase(), "explicit");
  if (opts.onboardingCountryCode) return make(opts.onboardingCountryCode.toUpperCase(), "onboarding");
  if (opts.stripeCountryCode) return make(opts.stripeCountryCode.toUpperCase(), "stripe");

  const fromLocale = resolveCountryFromAcceptLanguage(opts.acceptLanguage ?? null);
  if (fromLocale) return make(fromLocale, "locale");

  return make(null, "unresolved");
}
