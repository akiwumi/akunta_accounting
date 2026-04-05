"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type Locale } from "@/lib/i18n/locale";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  englishLabel: string;
  swedishLabel: string;
};

export const LanguageSwitcher = ({
  locale,
  label,
  englishLabel,
  swedishLabel
}: LanguageSwitcherProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<Locale>(locale);

  const onChange = (nextLocale: Locale) => {
    setValue(nextLocale);
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale })
      });
      router.refresh();
    });
  };

  return (
    <label className="navLocaleControl">
      <span className="note">{label}</span>
      <select
        value={value}
        disabled={isPending}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        <option value="en">{englishLabel}</option>
        <option value="sv">{swedishLabel}</option>
      </select>
    </label>
  );
};
