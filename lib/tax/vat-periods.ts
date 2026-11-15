/**
 * VAT reporting periods (redovisningsperioder) and filing deadlines.
 *
 * Source for the deadline rules, read 2026-11-15:
 * https://www.skatteverket.se/foretag/moms/deklareramoms/narskajagdeklareramoms.4.6d02084411db6e252fe80008988.html
 *
 *  - Monthly, taxable turnover up to SEK 40 million: the 12th of the second
 *    month after the period; the 17th when that month is January or August.
 *  - Monthly, turnover above SEK 40 million: the 26th of the month after the
 *    period; the 27th in December.
 *  - Quarterly (calendar quarters): the 12th of the second month after the
 *    quarter; the 17th in August.
 *  - Yearly, sole trader (enskild näringsidkare) without EU trade: 12 May the
 *    year after the tax year ends. With EU trade: 26 February.
 *  - Yearly, company filing an income tax return digitally, without EU trade:
 *    depends on the month the fiscal year ends (see companyYearlyDeadline).
 *    With EU trade: the 26th of the second month after the period (27th in
 *    December).
 *
 * A deadline that falls on a Saturday, Sunday, public holiday, Midsummer Eve,
 * Christmas Eve or New Year's Eve moves to the next working day (lag 1930:173
 * om beräkning av lagstadgad tid). The Skatteverket page above does not repeat
 * that rule, so it is applied here from the statute.
 *
 * The app does not know whether a business trades with other EU countries or
 * has a turnover above SEK 40 million. Callers pass those as options and the
 * UI states the assumption (no EU trade, turnover up to SEK 40 million).
 *
 * Everything in this file is pure: no database access.
 */

import { fiscalYearPeriod, getFiscalYearForDate, normalizeFiscalYearStartMonth } from "@/lib/data/period";

export type VatFrequency = "monthly" | "quarterly" | "yearly";

export type VatDeadlineRule =
  | "monthly12"
  | "monthly17"
  | "monthly26"
  | "quarterly12"
  | "quarterly17"
  | "yearlySoleTrader"
  | "yearlySoleTraderEu"
  | "yearlyCompany"
  | "yearlyCompanyEu";

export type VatPeriodOptions = {
  frequency: VatFrequency;
  /** 1-12. */
  fiscalYearStartMonth: number;
  /** Business.orgType. Anything other than "sole_trader" is treated as a company. */
  orgType?: string | null;
  /** True when the business buys from or sells to other EU countries. Default false. */
  euTrade?: boolean;
  /** True when taxable turnover exceeds SEK 40 million. Default false. */
  largeTurnover?: boolean;
};

export type VatPeriod = {
  /** Stable id used in URLs: "2026-01-01_2026-03-31". */
  key: string;
  frequency: VatFrequency;
  /** The fiscal year (by its starting calendar year) the period is listed under. */
  fiscalYear: number;
  /** First instant of the period, UTC. */
  start: Date;
  /** Last instant of the period, UTC (23:59:59.999). */
  end: Date;
  /** The Period value in Skatteverket's file: year and last month of the period, "YYYYMM". */
  skvPeriod: string;
  /** Last day to file and to have the payment booked on the tax account, UTC midnight. */
  deadline: Date;
  deadlineRule: VatDeadlineRule;
  /** True when the statutory day was a non-working day and the deadline moved. */
  deadlineMoved: boolean;
  /**
   * Yearly sole traders only: the earlier deadline (26 February) that applies
   * instead if the business has had EU trade. Null otherwise.
   */
  euTradeDeadline: Date | null;
};

export type VatPeriodStatus = "upcoming" | "ready" | "overdue" | "filed";

const utc = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const pad2 = (value: number) => String(value).padStart(2, "0");

export const normalizeVatFrequency = (value: string | null | undefined): VatFrequency =>
  value === "monthly" || value === "quarterly" ? value : "yearly";

/** Easter Sunday (Gregorian), anonymous algorithm. */
const easterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month - 1, day);
};

const addDays = (date: Date, days: number) => utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);

/** Days on which a statutory deadline cannot fall (lag 1930:173). */
export const isSwedishNonWorkingDay = (date: Date): boolean => {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return true;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const fixed = [
    [1, 1],
    [1, 6],
    [5, 1],
    [6, 6],
    [12, 24],
    [12, 25],
    [12, 26],
    [12, 31]
  ];
  if (fixed.some(([m, d]) => m === month && d === day)) return true;

  // Midsummer Eve: the Friday between 19 and 25 June.
  if (month === 6 && weekday === 5 && day >= 19 && day <= 25) return true;

  const easter = easterSunday(date.getUTCFullYear());
  const movable = [addDays(easter, -2), addDays(easter, 1), addDays(easter, 39)];
  return movable.some((holiday) => iso(holiday) === iso(date));
};

export const nextWorkingDay = (date: Date): Date => {
  let current = utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  while (isSwedishNonWorkingDay(current)) current = addDays(current, 1);
  return current;
};

/** Company with a yearly period that files its income tax return digitally, no EU trade. */
const companyYearlyDeadline = (end: Date): Date => {
  const endMonth = end.getUTCMonth() + 1;
  const endYear = end.getUTCFullYear();
  if (endMonth <= 4) return utc(endYear, 11, 12);
  if (endMonth <= 6) return utc(endYear + 1, 0, 17);
  if (endMonth <= 8) return utc(endYear + 1, 3, 12);
  return utc(endYear + 1, 7, 17);
};

/** The 26th of the month `monthsAfter` months after the period; the 27th in December. */
const twentySixth = (end: Date, monthsAfter: number): Date => {
  const base = utc(end.getUTCFullYear(), end.getUTCMonth() + monthsAfter, 1);
  return utc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCMonth() === 11 ? 27 : 26);
};

/** The 12th of the second month after the period; the 17th in January and August. */
const twelfth = (end: Date): { date: Date; seventeenth: boolean } => {
  const base = utc(end.getUTCFullYear(), end.getUTCMonth() + 2, 1);
  const seventeenth = base.getUTCMonth() === 0 || base.getUTCMonth() === 7;
  return { date: utc(base.getUTCFullYear(), base.getUTCMonth(), seventeenth ? 17 : 12), seventeenth };
};

export const vatDeadlineFor = (
  period: { end: Date; frequency: VatFrequency },
  options: Pick<VatPeriodOptions, "orgType" | "euTrade" | "largeTurnover"> = {}
): { deadline: Date; rule: VatDeadlineRule; moved: boolean } => {
  const soleTrader = (options.orgType ?? "sole_trader") === "sole_trader";
  let nominal: Date;
  let rule: VatDeadlineRule;

  if (period.frequency === "monthly") {
    if (options.largeTurnover) {
      nominal = twentySixth(period.end, 1);
      rule = "monthly26";
    } else {
      const result = twelfth(period.end);
      nominal = result.date;
      rule = result.seventeenth ? "monthly17" : "monthly12";
    }
  } else if (period.frequency === "quarterly") {
    const result = twelfth(period.end);
    nominal = result.date;
    rule = result.seventeenth ? "quarterly17" : "quarterly12";
  } else if (soleTrader) {
    const yearAfter = period.end.getUTCFullYear() + 1;
    nominal = options.euTrade ? utc(yearAfter, 1, 26) : utc(yearAfter, 4, 12);
    rule = options.euTrade ? "yearlySoleTraderEu" : "yearlySoleTrader";
  } else if (options.euTrade) {
    nominal = twentySixth(period.end, 2);
    rule = "yearlyCompanyEu";
  } else {
    nominal = companyYearlyDeadline(period.end);
    rule = "yearlyCompany";
  }

  const deadline = nextWorkingDay(nominal);
  return { deadline, rule, moved: iso(deadline) !== iso(nominal) };
};

const makePeriod = (
  startYear: number,
  startMonthIndex: number,
  months: number,
  fiscalYear: number,
  options: VatPeriodOptions
): VatPeriod => {
  const start = utc(startYear, startMonthIndex, 1);
  const end = new Date(Date.UTC(startYear, startMonthIndex + months, 0, 23, 59, 59, 999));
  const { deadline, rule, moved } = vatDeadlineFor({ end, frequency: options.frequency }, options);
  const soleTraderYearly = rule === "yearlySoleTrader";

  return {
    key: `${iso(start)}_${iso(end)}`,
    frequency: options.frequency,
    fiscalYear,
    start,
    end,
    skvPeriod: `${end.getUTCFullYear()}${pad2(end.getUTCMonth() + 1)}`,
    deadline,
    deadlineRule: rule,
    deadlineMoved: moved,
    euTradeDeadline: soleTraderYearly
      ? vatDeadlineFor({ end, frequency: "yearly" }, { ...options, euTrade: true }).deadline
      : null
  };
};

/**
 * The reporting periods of one fiscal year, oldest first.
 *
 * Monthly and quarterly periods follow the calendar (kalendermånad,
 * kalenderkvartal). For a fiscal year that does not start in January, April,
 * July or October, a quarter is listed under the fiscal year in which it ends.
 */
export const generateVatPeriods = (fiscalYear: number, options: VatPeriodOptions): VatPeriod[] => {
  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const { from } = fiscalYearPeriod(fiscalYear, startMonth);
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth();

  if (options.frequency === "yearly") {
    return [makePeriod(year, monthIndex, 12, fiscalYear, options)];
  }

  if (options.frequency === "monthly") {
    return Array.from({ length: 12 }, (_, i) => makePeriod(year, monthIndex + i, 1, fiscalYear, options));
  }

  const periods: VatPeriod[] = [];
  for (let i = 0; i < 12; i += 1) {
    const month = utc(year, monthIndex + i, 1);
    // A calendar quarter ends in March, June, September or December.
    if (month.getUTCMonth() % 3 === 2) {
      periods.push(makePeriod(month.getUTCFullYear(), month.getUTCMonth() - 2, 3, fiscalYear, options));
    }
  }
  return periods;
};

/** Today's date in Sweden as "YYYY-MM-DD". Deadlines are Swedish calendar days. */
export const swedishToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * Periods of the current and the previous fiscal year, oldest first.
 *
 * `activeFrom` is the first day the business can have had anything to report
 * (see vatActiveFrom in momsdeklaration.ts). A period that ended before that
 * day is left out: a business that started this year has no return to file,
 * and nothing overdue, for last year.
 */
export const listVatPeriods = (
  options: VatPeriodOptions,
  now: Date = new Date(),
  activeFrom: Date | null = null
): VatPeriod[] => {
  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const today = new Date(`${swedishToday(now)}T00:00:00.000Z`);
  const current = getFiscalYearForDate(today, startMonth);
  const periods = [...generateVatPeriods(current - 1, options), ...generateVatPeriods(current, options)];
  return activeFrom ? periods.filter((period) => period.end >= activeFrom) : periods;
};

/**
 * The period to open when the user has not chosen one: the oldest unfiled
 * period that is overdue or ready to file, else the period running today,
 * else the next one to come, else the latest. `rows` must be oldest first.
 */
export const pickDefaultVatPeriod = <T extends { period: Pick<VatPeriod, "start" | "end">; status: VatPeriodStatus }>(
  rows: T[],
  today: string = swedishToday()
): T | null =>
  rows.find((row) => row.status === "overdue" || row.status === "ready") ??
  rows.find((row) => row.status === "upcoming" && iso(row.period.start) <= today && today <= iso(row.period.end)) ??
  rows.find((row) => row.status === "upcoming") ??
  rows[rows.length - 1] ??
  null;

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Resolve a period key from a URL to a real reporting period under the
 * business's current settings. Returns null for anything that is not one.
 */
export const findVatPeriod = (key: string | null | undefined, options: VatPeriodOptions): VatPeriod | null => {
  if (!key || !KEY_PATTERN.test(key)) return null;
  const [, endIso] = key.split("_");
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(end.valueOf())) return null;

  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const fiscalYear = getFiscalYearForDate(end, startMonth);
  for (const year of [fiscalYear, fiscalYear - 1, fiscalYear + 1]) {
    const match = generateVatPeriods(year, options).find((period) => period.key === key);
    if (match) return match;
  }
  return null;
};

/**
 * upcoming: the period has not ended yet.
 * ready:    ended, deadline not passed.
 * overdue:  deadline passed and nothing filed.
 * filed:    the user has recorded the return as filed.
 */
export const vatPeriodStatus = (
  period: Pick<VatPeriod, "end" | "deadline">,
  state: { filed: boolean; today?: string }
): VatPeriodStatus => {
  if (state.filed) return "filed";
  const today = state.today ?? swedishToday();
  if (today <= iso(period.end)) return "upcoming";
  if (today > iso(period.deadline)) return "overdue";
  return "ready";
};

/** Whole days from today until the deadline. Negative when it has passed. */
export const daysUntil = (deadline: Date, today: string = swedishToday()): number =>
  Math.round((deadline.valueOf() - new Date(`${today}T00:00:00.000Z`).valueOf()) / 86_400_000);

const MONTHS_SV = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "12 maj 2027" / "12 May 2027". */
export const formatVatDate = (date: Date, locale: "sv" | "en"): string => {
  const months = locale === "sv" ? MONTHS_SV : MONTHS_EN;
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/** "Mars 2026", "Kvartal 1 2026 (januari till mars)", "Helår 2026". */
export const vatPeriodLabel = (period: Pick<VatPeriod, "start" | "end" | "frequency">, locale: "sv" | "en"): string => {
  const months = locale === "sv" ? MONTHS_SV : MONTHS_EN;
  const startMonth = months[period.start.getUTCMonth()];
  const endMonth = months[period.end.getUTCMonth()];
  const endYear = period.end.getUTCFullYear();

  if (period.frequency === "monthly") {
    return `${startMonth.charAt(0).toUpperCase()}${startMonth.slice(1)} ${endYear}`;
  }
  if (period.frequency === "quarterly") {
    const quarter = Math.floor(period.end.getUTCMonth() / 3) + 1;
    return locale === "sv"
      ? `Kvartal ${quarter} ${endYear} (${startMonth} till ${endMonth})`
      : `Quarter ${quarter} ${endYear} (${startMonth} to ${endMonth})`;
  }
  const startYear = period.start.getUTCFullYear();
  const years = startYear === endYear ? String(endYear) : `${startYear}/${endYear}`;
  return locale === "sv" ? `Helår ${years}` : `Full year ${years}`;
};

/** Period settings of a business, with the assumptions the app has to make. */
export const vatPeriodOptionsFor = (business: {
  vatFrequency: string;
  fiscalYearStart: Date | string;
  orgType?: string | null;
}): VatPeriodOptions => {
  const start = business.fiscalYearStart instanceof Date ? business.fiscalYearStart : new Date(business.fiscalYearStart);
  return {
    frequency: normalizeVatFrequency(business.vatFrequency),
    fiscalYearStartMonth: Number.isNaN(start.valueOf()) ? 1 : start.getUTCMonth() + 1,
    orgType: business.orgType ?? "sole_trader",
    // Not stored anywhere yet: the UI states both assumptions.
    euTrade: false,
    largeTurnover: false
  };
};
