/**
 * Swedish OCR payment references.
 *
 * Variant used: Bankgirot "variable length control" (OCR-referenskontroll med
 * variabel längd). The reference is all digits, 2 to 25 long, built as
 *
 *   <seed digits> <length digit> <check digit>
 *
 * - The check digit is the last digit and is calculated with modulus 10
 *   (Luhn): from the right, digits are weighted 2, 1, 2, 1 ...; products above
 *   9 have their two digits added; the check digit raises the sum to the next
 *   multiple of ten.
 * - The length digit is the second to last digit and is the total length of
 *   the reference, check digit included, modulo 10.
 *
 * A reference built this way also passes the "soft" and "hard" control levels,
 * which only look at the check digit, so it works whichever level the
 * business has agreed with its bank.
 *
 * Sources: Bankgirot, "OCR reference control" and "Beräkning av kontrollsiffra
 * 10-modulen" (2016-12-01).
 */

const onlyDigits = (value: string) => value.replace(/\D+/g, "");

/** Modulus 10 check digit for a string of digits that does not yet include it. */
export const luhnCheckDigit = (digits: string): number => {
  let sum = 0;
  let weight = 2;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const product = (digits.charCodeAt(index) - 48) * weight;
    sum += product > 9 ? product - 9 : product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
};

/** True when the last digit of an all-digit string is its modulus 10 check digit. */
export const isValidLuhn = (value: string): boolean => {
  if (!/^\d{2,}$/.test(value)) return false;
  return luhnCheckDigit(value.slice(0, -1)) === Number(value.slice(-1));
};

const MAX_OCR_LENGTH = 25;
const MAX_SEED_LENGTH = MAX_OCR_LENGTH - 2;

/**
 * Builds an OCR reference with length digit and check digit from any text that
 * contains digits (an invoice number, for instance). Returns null when the
 * seed has no digits.
 */
export const buildOcrReference = (seed: string): string | null => {
  let digits = onlyDigits(seed).replace(/^0+(?=\d)/, "");
  if (!digits) return null;
  if (digits.length > MAX_SEED_LENGTH) digits = digits.slice(-MAX_SEED_LENGTH);
  const lengthDigit = (digits.length + 2) % 10;
  const body = `${digits}${lengthDigit}`;
  return `${body}${luhnCheckDigit(body)}`;
};

/** Validates check digit and length digit of a variable length OCR reference. */
export const isValidOcrReference = (value: string): boolean => {
  if (!/^\d{2,25}$/.test(value)) return false;
  if (!isValidLuhn(value)) return false;
  if (value.length < 3) return true;
  return Number(value.charAt(value.length - 2)) === value.length % 10;
};

/**
 * OCR reference for an invoice. The digits of the invoice number are the seed,
 * so the customer and the bank statement show something recognisable. When the
 * number has no digits, or the reference is already taken, the fallback seed
 * (a running number) keeps it unique.
 */
export const ocrReferenceForInvoice = (input: {
  invoiceNumber: string;
  fallbackSequence: number;
  isTaken?: (candidate: string) => boolean;
}): string => {
  const taken = input.isTaken ?? (() => false);
  const primary = buildOcrReference(input.invoiceNumber);
  if (primary && !taken(primary)) return primary;

  const base = onlyDigits(input.invoiceNumber).slice(-12);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = buildOcrReference(`${base}${Math.max(1, input.fallbackSequence) + attempt}`);
    if (candidate && !taken(candidate)) return candidate;
  }
  return buildOcrReference(`${Date.now()}`) as string;
};
