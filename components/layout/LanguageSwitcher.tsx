"use client";

import { type Locale } from "@/lib/i18n/locale";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  englishLabel: string;
  swedishLabel: string;
};

export const LanguageSwitcher = ({ locale, label, englishLabel, swedishLabel }: LanguageSwitcherProps) => {
  // Sets cookie immediately for instant UI feedback, persists to DB, then reloads
  const setLocale = async (next: Locale) => {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    await fetch("/api/settings/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next })
    }).catch(() => {});
    window.location.reload();
  };

  return (
    <label className="navLocaleControl">
      <span className="note">{label}</span>
      <select value={locale} onChange={(e) => void setLocale(e.target.value as Locale)}>
        <option value="en">{englishLabel}</option>
        <option value="sv">{swedishLabel}</option>
      </select>
    </label>
  );
};
