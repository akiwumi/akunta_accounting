const DEFAULT_CURRENCY = "SEK";
const DEFAULT_LOCALE = "en-GB";

const normalizeCurrency = (currency: string | undefined | null) => {
  const candidate = (currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(candidate)) return DEFAULT_CURRENCY;
  return candidate;
};

export const formatMoney = (value: number, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) => {
  const amount = Number.isFinite(value) ? value : 0;
  const preferredCurrency = normalizeCurrency(currency);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: preferredCurrency,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2
    }).format(amount);
  }
};
