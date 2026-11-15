/**
 * SRU export of the NE-bilaga: the two files Skatteverket's e-services read,
 * INFO.SRU and BLANKETTER.SRU.
 *
 * Record layout, character set and sign convention:
 *   "Teknisk information om filöverföring" (replaces brochure SKV 269)
 *   https://www.skatteverket.se/foretag/inkomstdeklaration/forredovisningsbyraer/tekniskinformationomfiloverforing.4.13948c0e18e810bfa0cca8.html
 *
 * Field codes: the field-name tables published on that page, one zip per
 * beskattningsperiod ("Ändringar från och med 2024P4 / 2025P4 / 2026P4"):
 *   NE_SKV2161-12-02-23-02.xls  (in the 2024P4 zip)
 *   NE_SKV2161-13-02-25-02.xls  (2025P4)
 *   NE_SKV2161-14-02-26-02.xls  (2026P4)
 * The codes used here are identical in all three. The only change between them
 * is field 8008 (ersättningsfonder), removed from 2026P4, which is not exported.
 *
 * No codes are guessed: an income year without a table above produces no files.
 *
 * Rules applied (from the page above)
 *   - ISO 8859-1, one record per line, "#NAME value value".
 *   - The sign printed on the form applies and the amount is given as a
 *     positive number; a box with no printed sign carries its own sign.
 *   - A record must have a value: empty and zero boxes are left out.
 *   - #IDENTITET is person number (12 digits), date (YYYYMMDD) and time (HHMMSS).
 */

import type { NeBilaga } from "@/lib/tax/neBilaga";

/** Box id → field code (fältkod) on the NE form. */
export const NE_SRU_FIELD_CODES: Record<string, string> = {
  B1: "7200",
  B2: "7210",
  B3: "7211",
  B4: "7212",
  B5: "7213",
  B6: "7240",
  B7: "7250",
  B8: "7260",
  B9: "7280",
  B10: "7300",
  B11: "7320",
  B12: "7330",
  B13: "7380",
  B14: "7381",
  B15: "7382",
  B16: "7383",
  R1: "7400",
  R2: "7401",
  R3: "7402",
  R4: "7403",
  R5: "7500",
  R6: "7501",
  R7: "7502",
  R8: "7503",
  R9: "7504",
  R10: "7505",
  R11: "7440",
  R12: "7600",
  R13: "7601",
  R14: "7700",
  R15: "7602",
  R16: "7701",
  R18: "7702",
  R19: "7603",
  R20a: "7614",
  R20b: "7703",
  R22: "7704",
  R23: "7604",
  R24: "7705",
  R25: "7706",
  R26: "7605",
  R27: "7606",
  R28: "7707",
  R30: "7708",
  R31: "7607",
  R32: "7608",
  R34: "7709",
  R36: "7710",
  R37: "7609",
  R38: "7711",
  R39: "7712",
  R40: "7610",
  R41: "7713",
  R43: "7714",
  R44: "7611",
  R45: "7612",
  R46: "7613",
  R47: "7630",
  R48: "7730",
  /** Övriga uppgifter 2: car costs deducted by the standard rate per mil. */
  O2: "8002"
};

const GENERAL_FIELD_CODES = {
  periodStart: "7011",
  periodEnd: "7012",
  activity: "7020",
  helpedYes: "8046",
  helpedNo: "8047"
} as const;

/** Income years with a retrieved field-name table. Key = income year (calendar year). */
export const NE_SRU_EDITIONS: Record<number, { block: string; specification: string }> = {
  2024: { block: "NE-2024P4", specification: "NE_SKV2161-12-02-23-02" },
  2025: { block: "NE-2025P4", specification: "NE_SKV2161-13-02-25-02" },
  2026: { block: "NE-2026P4", specification: "NE_SKV2161-14-02-26-02" }
};

export const sruSupportedIncomeYears = () =>
  Object.keys(NE_SRU_EDITIONS)
    .map(Number)
    .sort((a, b) => a - b);

export const isSruYearSupported = (incomeYear: number) => NE_SRU_EDITIONS[incomeYear] !== undefined;

// ─── Person number ────────────────────────────────────────────────────────────

const luhnValid = (tenDigits: string) => {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    let digit = Number(tenDigits[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

/**
 * Person number in the form the SRU files want: 12 digits, century first
 * (640823-3234 → 196408233234). Accepts 10 or 12 digits with or without a
 * separator; "+" marks a person who has turned 100. Returns null if the check
 * digit is wrong.
 */
export const normalizePersonnummer = (input: string | null | undefined, now = new Date()): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  const plus = trimmed.includes("+");
  const digits = trimmed.replace(/\D/g, "");
  let full: string;
  if (digits.length === 12) {
    full = digits;
  } else if (digits.length === 10) {
    const currentYear = now.getUTCFullYear();
    const yy = Number(digits.slice(0, 2));
    let century = Math.floor(currentYear / 100);
    if (century * 100 + yy > currentYear) century -= 1;
    if (plus) century -= 1;
    full = `${century}${digits}`;
  } else {
    return null;
  }
  if (!/^(18|19|20)/.test(full)) return null;
  const month = Number(full.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return luhnValid(full.slice(2)) ? full : null;
};

export const birthYearFromPersonnummer = (input: string | null | undefined): number | null => {
  const normalized = normalizePersonnummer(input);
  return normalized ? Number(normalized.slice(0, 4)) : null;
};

// ─── Files ────────────────────────────────────────────────────────────────────

export type SruSubmitter = {
  /** The sole trader's own name. */
  name: string;
  personnummer: string;
  postalCode: string;
  city: string;
  address?: string | null;
  email?: string | null;
};

export type SruGeneral = {
  /** "Verksamhetens art", at most 80 characters, for example "datakonsult". */
  activity?: string | null;
  /** Whether a paid accountant helped prepare the year-end accounts (fields 8046/8047). */
  helped?: "yes" | "no" | null;
};

export type SruMissing = "unsupportedYear" | "name" | "personnummer" | "postalCode" | "city";

export type SruFiles = {
  block: string;
  specification: string;
  info: Buffer;
  blanketter: Buffer;
  /** The same content as text, for display and tests. */
  infoText: string;
  blanketterText: string;
};

/** Strings may not contain "#", line breaks or characters outside ISO 8859-1. */
const sruString = (value: string, maxLength: number) =>
  value
    .replace(/[#\r\n\t]/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const pad = (value: number) => String(value).padStart(2, "0");
const sruDate = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
const sruTime = (date: Date) => `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;

export const sruMissingDetails = (incomeYear: number, submitter: Partial<SruSubmitter> | null | undefined): SruMissing[] => {
  const missing: SruMissing[] = [];
  if (!isSruYearSupported(incomeYear)) missing.push("unsupportedYear");
  if (!submitter?.name || sruString(submitter.name, 250) === "") missing.push("name");
  if (!normalizePersonnummer(submitter?.personnummer)) missing.push("personnummer");
  if (!/^\d{5}$/.test((submitter?.postalCode ?? "").replace(/\s/g, ""))) missing.push("postalCode");
  if (!submitter?.city || sruString(submitter.city, 250) === "") missing.push("city");
  return missing;
};

/** The #UPPGIFT records for an NE-bilaga, as [field code, value] in form order. */
export const neSruFields = (ne: NeBilaga, general: SruGeneral = {}): Array<[string, string]> => {
  const fields: Array<[string, string]> = [
    [GENERAL_FIELD_CODES.periodStart, ne.periodStart.replace(/-/g, "")],
    [GENERAL_FIELD_CODES.periodEnd, ne.periodEnd.replace(/-/g, "")]
  ];
  const activity = general.activity ? sruString(general.activity, 80) : "";
  if (activity) fields.push([GENERAL_FIELD_CODES.activity, activity]);

  for (const box of ne.boxes) {
    const code = NE_SRU_FIELD_CODES[box.id];
    if (!code || box.amount === null || box.amount === 0) continue;
    fields.push([code, String(box.amount)]);
    // The accountant question sits between the income statement and the tax adjustments on the form.
    if (box.id === "R11" && general.helped) {
      fields.push([general.helped === "yes" ? GENERAL_FIELD_CODES.helpedYes : GENERAL_FIELD_CODES.helpedNo, "X"]);
    }
  }
  if (general.helped && !fields.some(([code]) => code === GENERAL_FIELD_CODES.helpedYes || code === GENERAL_FIELD_CODES.helpedNo)) {
    fields.push([general.helped === "yes" ? GENERAL_FIELD_CODES.helpedYes : GENERAL_FIELD_CODES.helpedNo, "X"]);
  }
  return fields;
};

export const buildNeSruFiles = (params: {
  ne: NeBilaga;
  submitter: SruSubmitter;
  general?: SruGeneral;
  createdAt?: Date;
  program?: string;
}): SruFiles => {
  const { ne, submitter } = params;
  const edition = NE_SRU_EDITIONS[ne.incomeYear];
  if (!edition) {
    throw new Error(`No SRU field codes are available for income year ${ne.incomeYear}.`);
  }
  const missing = sruMissingDetails(ne.incomeYear, submitter);
  if (missing.length > 0) throw new Error(`Details missing for the SRU files: ${missing.join(", ")}.`);

  const createdAt = params.createdAt ?? new Date();
  const personnummer = normalizePersonnummer(submitter.personnummer, createdAt)!;
  const name = sruString(submitter.name, 250);
  const date = sruDate(createdAt);
  const time = sruTime(createdAt);

  const info: string[] = [
    "#DATABESKRIVNING_START",
    "#PRODUKT SRU",
    `#SKAPAD ${date} ${time}`,
    `#PROGRAM ${sruString(params.program ?? "Akunta", 250)}`,
    "#FILNAMN BLANKETTER.SRU",
    "#DATABESKRIVNING_SLUT",
    "#MEDIELEV_START",
    `#ORGNR ${personnummer}`,
    `#NAMN ${name}`
  ];
  const address = submitter.address ? sruString(submitter.address, 250) : "";
  if (address) info.push(`#ADRESS ${address}`);
  info.push(`#POSTNR ${submitter.postalCode.replace(/\s/g, "")}`);
  info.push(`#POSTORT ${sruString(submitter.city, 250)}`);
  const email = submitter.email ? sruString(submitter.email, 250) : "";
  if (email) info.push(`#EMAIL ${email}`);
  info.push("#MEDIELEV_SLUT");

  const blanketter: string[] = [
    `#BLANKETT ${edition.block}`,
    `#IDENTITET ${personnummer} ${date} ${time}`,
    `#NAMN ${name}`,
    ...neSruFields(ne, params.general).map(([code, value]) => `#UPPGIFT ${code} ${value}`),
    "#BLANKETTSLUT",
    "#FIL_SLUT"
  ];

  const infoText = `${info.join("\r\n")}\r\n`;
  const blanketterText = `${blanketter.join("\r\n")}\r\n`;
  return {
    block: edition.block,
    specification: edition.specification,
    info: Buffer.from(infoText, "latin1"),
    blanketter: Buffer.from(blanketterText, "latin1"),
    infoText,
    blanketterText
  };
};
