/**
 * Every sentence the SIE import can say to a user, in Swedish and English.
 *
 * Each message says where the problem is (the line in the file when there is
 * one), what is wrong and what to do about it.
 */

import { type SieIssue } from "@/lib/sie/parse";

export type SieLocale = "sv" | "en";

type Params = Record<string, string | number>;

const p = (params: Params, key: string): string => String(params[key] ?? "");

const MESSAGES = {
  // ── Problems with the file itself ─────────────────────────────────────────
  EMPTY_FILE: {
    en: () => "The file is empty. Export it again from your old program and choose SIE 4.",
    sv: () => "Filen är tom. Exportera den igen från ditt gamla program och välj SIE 4."
  },
  TOO_LARGE: {
    en: (a: Params) =>
      `The file is larger than ${p(a, "limit")} MB, which is more than we can read in one go. Export one fiscal year per file and import them one at a time.`,
    sv: (a: Params) =>
      `Filen är större än ${p(a, "limit")} MB, vilket är mer än vi kan läsa på en gång. Exportera ett räkenskapsår per fil och importera dem ett i taget.`
  },
  NOT_SIE: {
    en: () =>
      "This does not look like a SIE file. A SIE file is a text file where each line starts with a label such as #FNAMN or #VER. Export it again from your old program and choose SIE 4.",
    sv: () =>
      "Det här ser inte ut som en SIE-fil. En SIE-fil är en textfil där varje rad börjar med en etikett som #FNAMN eller #VER. Exportera den igen från ditt gamla program och välj SIE 4."
  },
  MISSING_FIELD: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: the ${p(a, "label")} record is incomplete. The file may have been cut off or edited by hand. Export it again from your old program.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: posten ${p(a, "label")} är ofullständig. Filen kan ha blivit avklippt eller ändrad för hand. Exportera den igen från ditt gamla program.`
  },
  BAD_DATE: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: "${p(a, "value")}" is not a date. Dates in a SIE file are written as year, month and day without spaces, for example 20250131.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: "${p(a, "value")}" är inget datum. Datum i en SIE-fil skrivs som år, månad och dag utan mellanrum, till exempel 20250131.`
  },
  BAD_AMOUNT: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: "${p(a, "value")}" is not an amount. Amounts are written with a decimal point and at most two decimals, for example 1250.00.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: "${p(a, "value")}" är inget belopp. Belopp skrivs med decimalpunkt och högst två decimaler, till exempel 1250.00.`
  },
  BAD_ACCOUNT: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: "${p(a, "value")}" is not an account number. Account numbers contain digits only, for example 1930.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: "${p(a, "value")}" är inget kontonummer. Kontonummer består bara av siffror, till exempel 1930.`
  },
  BAD_YEAR_INDEX: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: "${p(a, "value")}" is not a year number. It should be 0 for the year the file covers or -1 for the year before.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: "${p(a, "value")}" är inget årsnummer. Det ska vara 0 för året filen gäller eller -1 för året innan.`
  },
  TRANS_OUTSIDE_VER: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: an entry row (#TRANS) stands outside any verification, so we cannot tell where it belongs. The file is damaged. Export it again from your old program.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: en konteringsrad (#TRANS) står utanför en verifikation, så vi kan inte veta vart den hör. Filen är skadad. Exportera den igen från ditt gamla program.`
  },
  VER_WITHOUT_ROWS: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: the verification is not followed by its entry rows. The file is damaged. Export it again from your old program.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: verifikationen följs inte av sina konteringsrader. Filen är skadad. Exportera den igen från ditt gamla program.`
  },
  VER_NOT_CLOSED: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: the verification that starts here never ends, so the file looks cut off. Export it again from your old program.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: verifikationen som börjar här avslutas aldrig, så filen verkar vara avklippt. Exportera den igen från ditt gamla program.`
  },
  UNTERMINATED_QUOTE: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: a text is missing its closing quotation mark. We read the rest of the line as the text.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: en text saknar avslutande citattecken. Vi läste resten av raden som text.`
  },

  // ── Things that stop the import ───────────────────────────────────────────
  NOT_TYPE4: {
    en: (a: Params) =>
      `This is a SIE type ${p(a, "type")} file. It holds balances only and no verifications (the individual bookkeeping entries), so there is nothing to book. Export again and choose SIE 4, which some programs call "transactions".`,
    sv: (a: Params) =>
      `Det här är en SIE-fil av typ ${p(a, "type")}. Den innehåller bara saldon och inga verifikationer (de enskilda bokföringsposterna), så det finns inget att bokföra. Exportera igen och välj SIE 4, som vissa program kallar "transaktioner".`
  },
  CURRENCY: {
    en: (a: Params) =>
      `The file is kept in ${p(a, "currency")} but your books in Akunta are kept in ${p(a, "base")}. Amounts cannot be mixed, so nothing was imported.`,
    sv: (a: Params) =>
      `Filen är förd i ${p(a, "currency")} men din bokföring i Akunta förs i ${p(a, "base")}. Beloppen går inte att blanda, så inget importerades.`
  },
  UNBALANCED: {
    en: (a: Params) =>
      `Line ${p(a, "line")}: verification ${p(a, "voucher")} dated ${p(a, "date")} does not balance. Debit is ${p(a, "debit")} and credit is ${p(a, "credit")}, a difference of ${p(a, "difference")}. Every verification must have equal debit and credit. Correct it in the program the file came from and export again.`,
    sv: (a: Params) =>
      `Rad ${p(a, "line")}: verifikation ${p(a, "voucher")} daterad ${p(a, "date")} balanserar inte. Debet är ${p(a, "debit")} och kredit är ${p(a, "credit")}, en skillnad på ${p(a, "difference")}. Varje verifikation måste ha lika mycket debet som kredit. Rätta den i programmet som filen kommer från och exportera igen.`
  },
  LOCKED: {
    en: (a: Params) =>
      `${p(a, "count")} of the verifications are dated in a period that is locked in Akunta (${p(a, "from")} to ${p(a, "to")}); the first is ${p(a, "voucher")} dated ${p(a, "date")} on line ${p(a, "line")}. Nothing may be booked into a locked period. Export only the open period from your old program, or unlock the period first (locked periods are listed under Compliance).`,
    sv: (a: Params) =>
      `${p(a, "count")} av verifikationerna är daterade i en period som är låst i Akunta (${p(a, "from")} till ${p(a, "to")}); den första är ${p(a, "voucher")} daterad ${p(a, "date")} på rad ${p(a, "line")}. Inget får bokföras i en låst period. Exportera bara den öppna perioden från ditt gamla program, eller lås upp perioden först (låsta perioder visas under Kravlista).`
  },
  LOCKED_OPENING: {
    en: (a: Params) =>
      `The file has opening balances for ${p(a, "year")}, but that year starts in a period that is locked in Akunta (${p(a, "from")} to ${p(a, "to")}). Unlock the period first (locked periods are listed under Compliance).`,
    sv: (a: Params) =>
      `Filen har ingående balanser för ${p(a, "year")}, men det året börjar i en period som är låst i Akunta (${p(a, "from")} till ${p(a, "to")}). Lås upp perioden först (låsta perioder visas under Kravlista).`
  },
  ALREADY_IMPORTED: {
    en: (a: Params) =>
      `This file was already imported on ${p(a, "date")}. Importing it again would book every verification twice, so nothing was done. You find the imported verifications under Transactions.`,
    sv: (a: Params) =>
      `Den här filen importerades redan ${p(a, "date")}. Att importera den igen skulle bokföra varje verifikation två gånger, så inget gjordes. De importerade verifikationerna finns under Transaktioner.`
  },
  NOTHING_TO_IMPORT: {
    en: () =>
      "There is nothing new to import: the file has no verifications or opening balances that are not already in Akunta.",
    sv: () =>
      "Det finns inget nytt att importera: filen har inga verifikationer eller ingående balanser som inte redan finns i Akunta."
  },

  // ── Warnings: the import can go ahead, but look at this first ─────────────
  FLAG_SET: {
    en: () =>
      "The file is marked as already read by another program. That is fine if you are moving your books here, but make sure it is the right file.",
    sv: () =>
      "Filen är markerad som redan inläst av ett annat program. Det gör inget om du flyttar din bokföring hit, men kontrollera att det är rätt fil."
  },
  NON_CALENDAR_YEAR: {
    en: (a: Params) =>
      `The fiscal year in the file runs from ${p(a, "start")} to ${p(a, "end")}. Akunta works in calendar years, so the opening balances are left out. The verifications are imported on their own dates.`,
    sv: (a: Params) =>
      `Räkenskapsåret i filen löper från ${p(a, "start")} till ${p(a, "end")}. Akunta arbetar med kalenderår, så de ingående balanserna tas inte med. Verifikationerna importeras på sina egna datum.`
  },
  DATE_OUTSIDE_YEAR: {
    en: (a: Params) =>
      `${p(a, "count")} verifications are dated outside the fiscal year the file says it covers (the first is ${p(a, "voucher")} dated ${p(a, "date")}). They are imported on the date they carry.`,
    sv: (a: Params) =>
      `${p(a, "count")} verifikationer är daterade utanför räkenskapsåret som filen säger sig gälla (den första är ${p(a, "voucher")} daterad ${p(a, "date")}). De importeras på det datum de har.`
  },
  EXISTING_ENTRIES: {
    en: (a: Params) =>
      `You already have ${p(a, "count")} verifications in Akunta dated in ${p(a, "year")}. The imported ones are added next to them. If you have booked the same events in both programs they will count twice, so compare before you confirm.`,
    sv: (a: Params) =>
      `Du har redan ${p(a, "count")} verifikationer i Akunta daterade ${p(a, "year")}. De importerade läggs till bredvid dem. Om du har bokfört samma händelser i båda programmen räknas de dubbelt, så jämför innan du bekräftar.`
  },
  IB_UNBALANCED: {
    en: (a: Params) =>
      `The opening balances in the file do not add up to zero (they are off by ${p(a, "difference")}). They are imported as they are, so the balance sheet will be off by the same amount until it is corrected.`,
    sv: (a: Params) =>
      `De ingående balanserna i filen summerar inte till noll (de skiljer ${p(a, "difference")}). De importeras som de är, så balansräkningen kommer att skilja lika mycket tills det rättas.`
  },
  CLOSING_MISMATCH: {
    en: (a: Params) =>
      `For ${p(a, "count")} accounts the closing balance in the file is not what the opening balance plus the verifications add up to (for example ${p(a, "examples")}). The file may cover only part of the year. Akunta will show the sum of what is imported.`,
    sv: (a: Params) =>
      `För ${p(a, "count")} konton stämmer inte den utgående balansen i filen med ingående balans plus verifikationerna (till exempel ${p(a, "examples")}). Filen kanske bara gäller en del av året. Akunta visar summan av det som importeras.`
  },
  OB_CONFLICT: {
    en: (a: Params) =>
      `Akunta already has an opening balance for ${p(a, "year")} on ${p(a, "count")} accounts that differs from the file (${p(a, "examples")}). The amounts already in Akunta are kept.`,
    sv: (a: Params) =>
      `Akunta har redan en ingående balans för ${p(a, "year")} på ${p(a, "count")} konton som skiljer sig från filen (${p(a, "examples")}). Beloppen som redan finns i Akunta behålls.`
  },
  UNDECLARED_ACCOUNTS: {
    en: (a: Params) =>
      `The file uses ${p(a, "count")} accounts without giving them a name (${p(a, "examples")}). They are created with the account number as their name; you can rename them later.`,
    sv: (a: Params) =>
      `Filen använder ${p(a, "count")} konton utan att ge dem ett namn (${p(a, "examples")}). De skapas med kontonumret som namn; du kan döpa om dem senare.`
  },
  IB_ON_RESULT_ACCOUNT: {
    en: (a: Params) =>
      `The file has opening balances on ${p(a, "count")} income or expense accounts (${p(a, "examples")}). Such accounts start every year at zero, so those balances are left out.`,
    sv: (a: Params) =>
      `Filen har ingående balanser på ${p(a, "count")} intäkts- eller kostnadskonton (${p(a, "examples")}). Sådana konton börjar varje år på noll, så de balanserna tas inte med.`
  },

  // ── Skipped: left out on purpose, and why ─────────────────────────────────
  DUPLICATE_VOUCHERS: {
    en: (a: Params) =>
      `${p(a, "count")} verifications were imported from an earlier file and are not imported again.`,
    sv: (a: Params) =>
      `${p(a, "count")} verifikationer importerades från en tidigare fil och importeras inte igen.`
  },
  EMPTY_VOUCHERS: {
    en: (a: Params) => `${p(a, "count")} verifications have no amounts and are left out.`,
    sv: (a: Params) => `${p(a, "count")} verifikationer saknar belopp och tas inte med.`
  },
  UNUSED_ACCOUNTS: {
    en: (a: Params) =>
      `${p(a, "count")} accounts in the file are never used in it and are not created, to keep your chart of accounts short. You can add any of them later.`,
    sv: (a: Params) =>
      `${p(a, "count")} konton i filen används aldrig i den och skapas inte, för att hålla din kontoplan kort. Du kan lägga till dem senare.`
  },
  COMPARISON_YEARS: {
    en: () =>
      "Balances for earlier years, kept in the file for comparison, are not imported. To bring in an earlier year, export that year as its own file and import it too.",
    sv: () =>
      "Saldon för tidigare år, som finns i filen som jämförelse, importeras inte. Vill du ta med ett tidigare år exporterar du det året som en egen fil och importerar den också."
  },
  OBJECTS: {
    en: () => "Cost centres and projects on the entry rows are not imported. Akunta does not use them.",
    sv: () => "Kostnadsställen och projekt på konteringsraderna importeras inte. Akunta använder dem inte."
  },
  NAME_DIFFERS: {
    en: (a: Params) =>
      `${p(a, "count")} accounts already exist in Akunta under a different name (for example ${p(a, "examples")}). Akunta's names are kept.`,
    sv: (a: Params) =>
      `${p(a, "count")} konton finns redan i Akunta med ett annat namn (till exempel ${p(a, "examples")}). Akuntas namn behålls.`
  },
  ROW_DATES: {
    en: (a: Params) =>
      `${p(a, "count")} entry rows carry their own date, different from their verification. Each verification is booked on its verification date.`,
    sv: (a: Params) =>
      `${p(a, "count")} konteringsrader har ett eget datum som skiljer sig från verifikationens. Varje verifikation bokförs på sitt verifikationsdatum.`
  }
} as const;

export type SieMessageCode = keyof typeof MESSAGES;

export const sieMessage = (locale: SieLocale, code: SieMessageCode, params: Params = {}): string =>
  (MESSAGES[code][locale] as (a: Params) => string)(params);

export const describeSieIssue = (locale: SieLocale, issue: SieIssue): string =>
  sieMessage(locale, issue.code, { line: issue.line, label: issue.label ?? "", value: issue.value ?? "" });

/** "1234.50" for English, "1234,50" for Swedish. */
export const sieMoney = (locale: SieLocale, ore: number): string => {
  const abs = Math.abs(ore);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const cents = String(abs % 100).padStart(2, "0");
  return `${ore < 0 ? "-" : ""}${whole}${locale === "sv" ? "," : "."}${cents}`;
};

/** "20250131" to "2025-01-31". */
export const sieIsoDate = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
