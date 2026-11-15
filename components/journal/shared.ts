/**
 * Helpers shared by the journal entry components. Nothing here touches the
 * database, so the file is safe to import from client components.
 */

export type PickerAccount = { id: string; code: string; name: string; type: string };

export type PreviewLineView = {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  /** The account does not exist yet and is created when the entry is saved. */
  isNew?: boolean;
};

export type PreviewEntryView = {
  role?: "entry" | "reversal";
  txnDate: string;
  description: string;
  lines: PreviewLineView[];
  inVatReturn?: boolean;
  locked?: boolean;
};

/** "1 234,50", "1234.5" and "1.234,50" all read as 1234.5. Empty is null, nonsense is NaN. */
export const parseAmount = (raw: string): number | null => {
  const compact = raw.replace(/[\s ]/g, "").replace(/kr$/i, "");
  if (compact === "") return null;
  let normalized = compact;
  if (compact.includes(",")) normalized = compact.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
};

/** A typed amount that can be used: a number above zero. */
export const validAmount = (raw: string): number | null => {
  const value = parseAmount(raw);
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
};

export const toOre = (value: number) => Math.round(value * 100);

const isVatAccountCode = (code: string) => /^26[1-4]\d$/.test(code);

/** Mirrors booksVatOutsideSettlement in lib/accounting/journal.ts. */
export const booksVatOutsideSettlement = (codes: string[]) => codes.some(isVatAccountCode) && !codes.includes("2650");

/** What one line does, in words a person who has never heard of debit and credit can follow. */
export const explainLine = (sv: boolean, line: { code: string; type: string }, side: "debit" | "credit"): string => {
  const debit = side === "debit";
  const { code, type } = line;
  if (/^19/.test(code)) {
    return debit ? (sv ? "Pengar in på kontot" : "Money into the account") : sv ? "Pengar ut från kontot" : "Money out of the account";
  }
  if (/^1[0-2]\d9$/.test(code)) {
    return debit
      ? sv ? "Det bokförda värdet ökar" : "The book value goes up"
      : sv ? "Det bokförda värdet minskar" : "The book value goes down";
  }
  if (code === "1510") {
    return debit
      ? sv ? "Kunderna är skyldiga dig mer" : "Customers owe you more"
      : sv ? "Kunderna är skyldiga dig mindre" : "Customers owe you less";
  }
  if (code === "2012") {
    return debit
      ? sv ? "Din privata skatt, räknas som eget uttag" : "Your private tax, counted as a withdrawal"
      : sv ? "Privat skatt tillbaka till firman" : "Private tax returned to the business";
  }
  if (code === "2013") {
    return debit
      ? sv ? "Eget uttag: ditt kapital i firman minskar" : "Withdrawal: your capital in the business goes down"
      : sv ? "Uttaget minskar" : "The withdrawal is reduced";
  }
  if (code === "2018") {
    return debit
      ? sv ? "Insättningen minskar" : "The deposit is reduced"
      : sv ? "Egen insättning: ditt kapital i firman ökar" : "Deposit: your capital in the business goes up";
  }
  if (code === "2440") {
    return debit
      ? sv ? "Du är skyldig leverantörer mindre" : "You owe suppliers less"
      : sv ? "Du är skyldig leverantörer mer" : "You owe suppliers more";
  }
  if (code === "2650") {
    return debit
      ? sv ? "Momsen till Skatteverket regleras" : "VAT with Skatteverket is settled"
      : sv ? "Moms att reglera med Skatteverket" : "VAT to settle with Skatteverket";
  }
  if (/^264/.test(code)) {
    return debit
      ? sv ? "Moms du får dra av ökar" : "VAT you may deduct goes up"
      : sv ? "Moms du får dra av minskar" : "VAT you may deduct goes down";
  }
  if (/^26[123]/.test(code)) {
    return debit
      ? sv ? "Moms du ska betala minskar" : "VAT you owe goes down"
      : sv ? "Moms du ska betala ökar" : "VAT you owe goes up";
  }
  switch (type) {
    case "ASSET":
      return debit ? (sv ? "Tillgången ökar" : "The asset goes up") : sv ? "Tillgången minskar" : "The asset goes down";
    case "LIABILITY":
      return debit ? (sv ? "Skulden minskar" : "The debt goes down") : sv ? "Skulden ökar" : "The debt goes up";
    case "EQUITY":
      return debit
        ? sv ? "Ditt kapital i firman minskar" : "Your capital in the business goes down"
        : sv ? "Ditt kapital i firman ökar" : "Your capital in the business goes up";
    case "INCOME":
      return debit
        ? sv ? "Intäkten minskar" : "The income goes down"
        : sv ? "Intäkt: resultatet ökar" : "Income: the result goes up";
    default:
      return debit
        ? sv ? "Kostnad: resultatet minskar" : "Cost: the result goes down"
        : sv ? "Kostnaden minskar" : "The cost goes down";
  }
};

/** Messages for the error codes the journal API returns. Falls back to the server's own text. */
export const journalErrorText = (sv: boolean, code: string | undefined, fallback: string): string => {
  if (!sv) return fallback;
  switch (code) {
    case "UNBALANCED":
      return "Bokföringsordern balanserar inte: debet och kredit måste vara lika stora.";
    case "TOO_FEW_LINES":
      return "En bokföringsorder behöver minst två rader: en i debet och en i kredit.";
    case "LINE_AMOUNT":
      return "Varje rad ska ha ett belopp över noll i antingen debet eller kredit, inte i båda.";
    case "DESCRIPTION":
      return "Skriv en kort text som säger vad bokföringen gäller.";
    case "DATE":
      return "Välj ett giltigt datum.";
    case "LOCKED":
      return "Datumet ligger i en låst bokföringsperiod, så inget kan bokföras där. Välj ett datum i en öppen period.";
    case "ACCOUNT_INACTIVE":
      return "Ett av kontona är inaktivt. Aktivera det i kontoplanen eller välj ett annat konto.";
    case "ACCOUNT_FOREIGN":
      return "Ett av kontona finns inte i din kontoplan. Lägg till det i kontoplanen först.";
    case "VAT_ACCOUNTS":
      return "Bokföringen rör ett momskonto. Bekräfta varningen om moms innan du bokför.";
    case "INPUT":
      return "Kontrollera uppgifterna i formuläret och försök igen.";
    default:
      return fallback || "Det gick inte att bokföra. Försök igen.";
  }
};
