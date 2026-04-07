"use client";

import { type Locale } from "@/lib/i18n/locale";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  englishLabel: string;
  swedishLabel: string;
};

export const LanguageSwitcher = ({ locale, label, englishLabel, swedishLabel }: LanguageSwitcherProps) => {
  const setLocale = (next: Locale) => {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <label className="navLocaleControl">
      <span className="note">{label}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        <option value="en">{englishLabel}</option>
        <option value="sv">{swedishLabel}</option>
      </select>
    </label>
  );
};
