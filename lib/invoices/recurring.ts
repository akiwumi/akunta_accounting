/**
 * Recurring invoice schedules. Pure date arithmetic; the job that creates the
 * invoices lives in lib/invoices/recurring-run.ts.
 */

export const RecurringFrequencies = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  YEARLY: "YEARLY"
} as const;

export type RecurringFrequency = (typeof RecurringFrequencies)[keyof typeof RecurringFrequencies];

export const isRecurringFrequency = (value: string): value is RecurringFrequency =>
  value === "MONTHLY" || value === "QUARTERLY" || value === "YEARLY";

const MONTHS: Record<RecurringFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

const daysInMonth = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

export const isLastDayOfMonth = (date: Date) =>
  date.getUTCDate() === daysInMonth(date.getUTCFullYear(), date.getUTCMonth());

/**
 * The run date one period after `current`.
 *
 * `anchorDay` is the day of the month the schedule is meant to fall on. It
 * matters after a short month: a schedule on the 31st runs 31 Jan, 28 (or 29)
 * Feb, 31 Mar, not 28 Mar. Without an anchor the day of `current` is kept.
 */
export const advanceRunDate = (current: Date, frequency: RecurringFrequency, anchorDay?: number): Date => {
  const day = Math.min(31, Math.max(1, Math.trunc(anchorDay ?? current.getUTCDate())));
  const targetMonth = current.getUTCMonth() + MONTHS[frequency];
  const year = current.getUTCFullYear() + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))));
};

/**
 * Works out the anchor day when it is not stored. Only a run date on the last
 * day of a month can have been clamped, so only then is the history (the days
 * earlier invoices of the schedule were issued on) consulted.
 */
export const resolveAnchorDay = (current: Date, earlierRunDays: number[] = []): number => {
  const day = current.getUTCDate();
  if (!isLastDayOfMonth(current)) return day;
  return Math.max(day, ...earlierRunDays.filter((value) => Number.isInteger(value) && value >= 1 && value <= 31));
};

export type RecurringItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatMode: "NO_VAT" | "INCLUSIVE" | "EXCLUSIVE";
  vatRate: number;
};

/** Reads RecurringInvoice.itemsJson defensively. */
export const parseRecurringItems = (itemsJson: string): RecurringItem[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((raw): RecurringItem[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return [];
    }
    const vatMode = item.vatMode === "INCLUSIVE" || item.vatMode === "EXCLUSIVE" ? item.vatMode : "NO_VAT";
    const vatRate = Number.isFinite(Number(item.vatRate)) ? Number(item.vatRate) : 0;
    return [{ description, quantity, unitPrice, vatMode, vatRate }];
  });
};

export type RecurringState = "ACTIVE" | "PAUSED" | "ENDED";

/** A template is ended when it is inactive and its end date has passed; paused when merely inactive. */
export const recurringState = (
  template: { active: boolean; endDate: Date | null; nextRunDate: Date },
  today: Date
): RecurringState => {
  if (template.active) return "ACTIVE";
  if (template.endDate && template.endDate.valueOf() <= Math.max(today.valueOf(), template.nextRunDate.valueOf())) {
    return "ENDED";
  }
  return "PAUSED";
};
