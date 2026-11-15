/**
 * Validation and formatting of the accounts a customer can pay to:
 * bankgiro, plusgiro, IBAN + BIC and Swish. Pure functions, safe to use in
 * the browser and on the server.
 */

import { isValidLuhn } from "@/lib/invoices/ocr";

export type PaymentAccountField = "bankgiro" | "plusgiro" | "iban" | "bic" | "swishNumber";

type Result = { ok: true; value: string } | { ok: false; reason: "format" | "checksum" };

const digitsOf = (value: string) => value.replace(/[\s\-.]/g, "");

/** Bankgiro: 7 or 8 digits, the last one a modulus 10 check digit. Stored as NNN-NNNN or NNNN-NNNN. */
export const parseBankgiro = (input: string): Result => {
  const digits = digitsOf(input);
  if (!/^\d{7,8}$/.test(digits)) return { ok: false, reason: "format" };
  if (!isValidLuhn(digits)) return { ok: false, reason: "checksum" };
  return { ok: true, value: `${digits.slice(0, -4)}-${digits.slice(-4)}` };
};

/** Plusgiro: 2 to 8 digits, the last one a modulus 10 check digit. Stored as NNNNNN-N. */
export const parsePlusgiro = (input: string): Result => {
  const digits = digitsOf(input);
  if (!/^\d{2,8}$/.test(digits)) return { ok: false, reason: "format" };
  if (!isValidLuhn(digits)) return { ok: false, reason: "checksum" };
  return { ok: true, value: `${digits.slice(0, -1)}-${digits.slice(-1)}` };
};

const IBAN_LENGTHS: Record<string, number> = {
  SE: 24, NO: 15, DK: 18, FI: 18, DE: 22, GB: 22, NL: 18, FR: 27, ES: 24, IT: 27, PL: 28, EE: 20, LV: 21, LT: 20
};

/** IBAN: country code, two check digits, account. Valid when the rearranged number mod 97 is 1 (ISO 13616). */
export const parseIban = (input: string): Result => {
  const iban = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { ok: false, reason: "format" };
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expectedLength && iban.length !== expectedLength) return { ok: false, reason: "format" };

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const chunk = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of chunk) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  if (remainder !== 1) return { ok: false, reason: "checksum" };
  return { ok: true, value: iban };
};

/** BIC / SWIFT: 8 or 11 characters. */
export const parseBic = (input: string): Result => {
  const bic = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return { ok: false, reason: "format" };
  return { ok: true, value: bic };
};

/** Swish: a Swedish mobile number (07x) or a Swish business number (123 followed by seven digits). */
export const parseSwish = (input: string): Result => {
  let digits = digitsOf(input).replace(/[()]/g, "");
  if (digits.startsWith("+46")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0046")) digits = `0${digits.slice(4)}`;
  if (/^07\d{8}$/.test(digits) || /^123\d{7}$/.test(digits)) return { ok: true, value: digits };
  return { ok: false, reason: "format" };
};

const parsers: Record<PaymentAccountField, (input: string) => Result> = {
  bankgiro: parseBankgiro,
  plusgiro: parsePlusgiro,
  iban: parseIban,
  bic: parseBic,
  swishNumber: parseSwish
};

export const parsePaymentAccount = (field: PaymentAccountField, input: string): Result => parsers[field](input);

export const formatIban = (iban: string) => iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

export const formatSwish = (value: string) =>
  /^123\d{7}$/.test(value)
    ? `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6, 8)} ${value.slice(8)}`
    : /^07\d{8}$/.test(value)
      ? `${value.slice(0, 3)}-${value.slice(3, 6)} ${value.slice(6, 8)} ${value.slice(8)}`
      : value;

/** A message a person can act on, for a failed field. */
export const paymentAccountMessage = (
  field: PaymentAccountField,
  reason: "format" | "checksum",
  locale: "sv" | "en"
): string => {
  const sv: Record<PaymentAccountField, Record<"format" | "checksum", string>> = {
    bankgiro: {
      format: "Ett bankgironummer har 7 eller 8 siffror, till exempel 123-4567.",
      checksum: "Bankgironumret stämmer inte. Kontrollera siffrorna mot ditt bankavtal, en siffra är troligen fel."
    },
    plusgiro: {
      format: "Ett plusgironummer har 2 till 8 siffror, till exempel 12 34 56-7.",
      checksum: "Plusgironumret stämmer inte. Kontrollera siffrorna, en siffra är troligen fel."
    },
    iban: {
      format: "Ett svenskt IBAN börjar med SE och har 24 tecken, till exempel SE35 5000 0000 0549 1000 0003.",
      checksum: "IBAN-numret stämmer inte. Kontrollera att alla tecken är rätt inskrivna."
    },
    bic: {
      format: "BIC (SWIFT) har 8 eller 11 tecken, till exempel ESSESESS.",
      checksum: "BIC-koden stämmer inte."
    },
    swishNumber: {
      format: "Ange ett mobilnummer (07x) eller ett Swish-företagsnummer som börjar på 123.",
      checksum: "Swish-numret stämmer inte."
    }
  };
  const en: Record<PaymentAccountField, Record<"format" | "checksum", string>> = {
    bankgiro: {
      format: "A bankgiro number has 7 or 8 digits, for example 123-4567.",
      checksum: "That bankgiro number is not valid. Check it against your bank agreement, one digit is probably wrong."
    },
    plusgiro: {
      format: "A plusgiro number has 2 to 8 digits, for example 12 34 56-7.",
      checksum: "That plusgiro number is not valid. Check the digits, one is probably wrong."
    },
    iban: {
      format: "A Swedish IBAN starts with SE and has 24 characters, for example SE35 5000 0000 0549 1000 0003.",
      checksum: "That IBAN is not valid. Check that every character is typed correctly."
    },
    bic: {
      format: "A BIC (SWIFT) code has 8 or 11 characters, for example ESSESESS.",
      checksum: "That BIC code is not valid."
    },
    swishNumber: {
      format: "Enter a mobile number (07x) or a Swish business number starting with 123.",
      checksum: "That Swish number is not valid."
    }
  };
  return (locale === "sv" ? sv : en)[field][reason];
};

export type PaymentAccounts = {
  bankgiro?: string | null;
  plusgiro?: string | null;
  iban?: string | null;
  bic?: string | null;
  swishNumber?: string | null;
};

/** Label and value pairs for whichever accounts the business has set, in the order a Swedish payer expects. */
export const paymentAccountLines = (accounts: PaymentAccounts) => {
  const lines: { label: string; value: string }[] = [];
  if (accounts.bankgiro?.trim()) lines.push({ label: "Bankgiro", value: accounts.bankgiro.trim() });
  if (accounts.plusgiro?.trim()) lines.push({ label: "Plusgiro", value: accounts.plusgiro.trim() });
  if (accounts.swishNumber?.trim()) lines.push({ label: "Swish", value: formatSwish(accounts.swishNumber.trim()) });
  if (accounts.iban?.trim()) {
    lines.push({ label: "IBAN", value: formatIban(accounts.iban.trim()) });
    if (accounts.bic?.trim()) lines.push({ label: "BIC (SWIFT)", value: accounts.bic.trim() });
  }
  return lines;
};
