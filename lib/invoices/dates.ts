/**
 * Date-only helpers. Invoice dates are stored as UTC midnight of the calendar
 * day, and "today" means today in Sweden, whatever the server clock says.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export const parseIsoDate = (value: string | null | undefined): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
};

/** Today's calendar date in Europe/Stockholm, as UTC midnight. */
export const stockholmToday = (now: Date = new Date()): Date => {
  const iso = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return new Date(`${iso}T00:00:00.000Z`);
};

export const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const addDays = (date: Date, days: number) => new Date(startOfUtcDay(date).valueOf() + days * DAY_MS);

/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfUtcDay(b).valueOf() - startOfUtcDay(a).valueOf()) / DAY_MS);
