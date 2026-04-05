export const parseTaxYear = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;

  const year = Number(trimmed);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return year;
};

export const calendarYearPeriod = (year: number) => ({
  from: new Date(Date.UTC(year, 0, 1)),
  to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
});

export const parseMonth = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;

  const month = Number(trimmed);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
};

export const calendarMonthPeriod = (year: number, month: number) => ({
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
});

export const resolveReportPeriod = (params: URLSearchParams) => {
  const taxYear = parseTaxYear(params.get("year"));
  if (taxYear !== null) {
    return calendarYearPeriod(taxYear);
  }

  const fromRaw = params.get("from");
  const toRaw = params.get("to");

  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const from = fromRaw ? new Date(fromRaw) : new Date(Date.UTC(currentYear, 0, 1));
  const to = toRaw ? new Date(toRaw) : new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));

  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) {
    throw new Error("Invalid date range.");
  }

  return { from, to };
};
