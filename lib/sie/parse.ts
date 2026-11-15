/**
 * Reader for SIE type 4 files.
 *
 * Record layouts follow "SIE filformat, utgåva 4B" (SIE-Gruppen, 2008-09-30),
 * https://sie.se/wp-content/uploads/2020/05/SIE_filformat_ver_4B_080930.pdf
 *
 *   #FLAGGA x
 *   #PROGRAM programnamn version
 *   #FORMAT PC8
 *   #GEN datum sign
 *   #SIETYP typnr
 *   #FNAMN företagsnamn
 *   #ORGNR orgnr förvnr verknr
 *   #RAR årsnr start slut
 *   #KPTYP typ
 *   #VALUTA valutakod
 *   #KONTO kontonr kontonamn
 *   #KTYP kontonr kontotyp                (T, S, K or I)
 *   #IB årsnr konto saldo kvantitet
 *   #UB årsnr konto saldo kvantitet
 *   #RES årsnr konto saldo kvantitet
 *   #VER serie vernr verdatum vertext regdatum sign
 *   {
 *     #TRANS kontonr {objektlista} belopp transdat transtext kvantitet sign
 *   }
 *
 * Rules applied here (section 5 of the specification):
 *   - fields are separated by spaces or tabs and may be quoted; a quote inside
 *     a quoted field is written \" ;
 *   - amounts use a decimal point, at most two decimals, a leading minus for
 *     credit and never a plus sign;
 *   - dates are YYYYMMDD;
 *   - blank lines, unknown labels and unknown trailing fields are ignored;
 *   - #RTRANS and #BTRANS (added and removed rows) are ignored, which the
 *     specification allows: every #RTRANS is followed by an identical #TRANS,
 *     so reading only #TRANS gives the voucher as it stands today.
 *
 * Amounts are kept as whole öre so that nothing is lost to floating point.
 */

export type SieIssueCode =
  | "NOT_SIE"
  | "MISSING_FIELD"
  | "BAD_DATE"
  | "BAD_AMOUNT"
  | "BAD_ACCOUNT"
  | "BAD_YEAR_INDEX"
  | "TRANS_OUTSIDE_VER"
  | "VER_WITHOUT_ROWS"
  | "VER_NOT_CLOSED"
  | "UNTERMINATED_QUOTE";

export type SieIssue = {
  severity: "error" | "warning";
  code: SieIssueCode;
  /** 1-based line number in the file. */
  line: number;
  label?: string;
  value?: string;
};

export type SieFiscalYear = { index: number; start: string; end: string; line: number };
export type SieAccount = { code: string; name: string; type?: "T" | "S" | "K" | "I"; line: number };
export type SieBalance = { yearIndex: number; account: string; amountOre: number; line: number };
export type SieVoucherLine = {
  account: string;
  /** Positive is debit, negative is credit. */
  amountOre: number;
  date?: string;
  text?: string;
  hasObjects: boolean;
  line: number;
};
export type SieVoucher = {
  series: string;
  number: string;
  /** YYYYMMDD */
  date: string;
  text: string;
  regDate?: string;
  lines: SieVoucherLine[];
  line: number;
};

export type SieDocument = {
  flag: number | null;
  program: string | null;
  programVersion: string | null;
  format: string | null;
  generated: string | null;
  sieType: number | null;
  companyName: string | null;
  orgNumber: string | null;
  accountPlanType: string | null;
  currency: string | null;
  fiscalYears: SieFiscalYear[];
  accounts: Map<string, SieAccount>;
  openingBalances: SieBalance[];
  closingBalances: SieBalance[];
  results: SieBalance[];
  vouchers: SieVoucher[];
  issues: SieIssue[];
};

type Token =
  | { kind: "field"; value: string }
  | { kind: "list"; values: string[] }
  | { kind: "open" }
  | { kind: "close" };

const isSpace = (char: string) => char === " " || char === "\t";

/** Split one line into fields. Returns the tokens and whether a quote was left open. */
const tokenize = (line: string): { tokens: Token[]; unterminated: boolean } => {
  const tokens: Token[] = [];
  let unterminated = false;
  let i = 0;

  const readQuoted = (): string => {
    // line[i] is the opening quote
    let value = "";
    i += 1;
    while (i < line.length) {
      const char = line[i];
      if (char === "\\" && line[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        i += 1;
        return value;
      }
      value += char;
      i += 1;
    }
    unterminated = true;
    return value;
  };

  const readBare = (stopAtBrace: boolean): string => {
    let value = "";
    while (i < line.length && !isSpace(line[i]) && !(stopAtBrace && line[i] === "}")) {
      value += line[i];
      i += 1;
    }
    return value;
  };

  while (i < line.length) {
    const char = line[i];
    if (isSpace(char)) {
      i += 1;
    } else if (char === '"') {
      tokens.push({ kind: "field", value: readQuoted() });
    } else if (char === "{") {
      i += 1;
      const values: string[] = [];
      let closed = false;
      while (i < line.length) {
        if (isSpace(line[i])) {
          i += 1;
        } else if (line[i] === "}") {
          i += 1;
          closed = true;
          break;
        } else if (line[i] === '"') {
          values.push(readQuoted());
        } else {
          values.push(readBare(true));
        }
      }
      if (closed) {
        tokens.push({ kind: "list", values });
      } else {
        // "{" alone (or at the end of a #VER line) opens a block of sub-records.
        tokens.push({ kind: "open" });
        for (const value of values) tokens.push({ kind: "field", value });
      }
    } else if (char === "}") {
      i += 1;
      tokens.push({ kind: "close" });
    } else {
      tokens.push({ kind: "field", value: readBare(false) });
    }
  }
  return { tokens, unterminated };
};

const isValidDate = (value: string): boolean => {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/**
 * "1234.5" to 123450 öre. A decimal comma is accepted as well: it is not
 * allowed by the standard but appears in hand-edited files and is unambiguous.
 */
export const parseSieAmount = (value: string): number | null => {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const ore = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(ore)) return null;
  return match[1] === "-" && ore !== 0 ? -ore : ore;
};

/** 123450 to "1234.50". */
export const formatSieAmount = (ore: number): string => {
  const abs = Math.abs(ore);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${ore < 0 ? "-" : ""}${whole}.${cents}`;
};

/** "20240131" to a UTC date at midnight, as the ledger stores transaction dates. */
export const sieDateToUtc = (value: string): Date =>
  new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));

const MAX_ISSUES = 50;

export const parseSie = (text: string): SieDocument => {
  const doc: SieDocument = {
    flag: null,
    program: null,
    programVersion: null,
    format: null,
    generated: null,
    sieType: null,
    companyName: null,
    orgNumber: null,
    accountPlanType: null,
    currency: null,
    fiscalYears: [],
    accounts: new Map(),
    openingBalances: [],
    closingBalances: [],
    results: [],
    vouchers: [],
    issues: []
  };

  const report = (issue: SieIssue) => {
    if (doc.issues.length < MAX_ISSUES) doc.issues.push(issue);
  };

  let sawLabel = false;
  /** A #VER whose "{" has not been seen yet. */
  let pending: SieVoucher | null = null;
  /** The #VER whose block is open. */
  let current: SieVoucher | null = null;

  const closePendingWithoutRows = () => {
    if (pending) {
      report({ severity: "error", code: "VER_WITHOUT_ROWS", line: pending.line });
      pending = null;
    }
  };

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index].replace(/\r$/, "");
    if (raw.trim() === "") continue;

    const { tokens, unterminated } = tokenize(raw);
    if (unterminated) report({ severity: "warning", code: "UNTERMINATED_QUOTE", line: lineNumber });
    if (tokens.length === 0) continue;

    const first = tokens[0];
    if (first.kind === "open") {
      if (pending) {
        current = pending;
        pending = null;
      }
      continue;
    }
    if (first.kind === "close") {
      if (current) {
        doc.vouchers.push(current);
        current = null;
      }
      continue;
    }
    if (first.kind !== "field" || !first.value.startsWith("#")) continue;

    sawLabel = true;
    const label = first.value.toUpperCase();
    const rest = tokens.slice(1);
    const fields = rest.filter((t): t is { kind: "field"; value: string } => t.kind === "field").map((t) => t.value);

    const need = (count: number): boolean => {
      if (fields.length >= count) return true;
      report({ severity: "error", code: "MISSING_FIELD", line: lineNumber, label });
      return false;
    };
    const account = (value: string): string | null => {
      if (/^\d{1,10}$/.test(value)) return value;
      report({ severity: "error", code: "BAD_ACCOUNT", line: lineNumber, value });
      return null;
    };
    const amount = (value: string): number | null => {
      const ore = parseSieAmount(value);
      if (ore === null) report({ severity: "error", code: "BAD_AMOUNT", line: lineNumber, value });
      return ore;
    };
    const date = (value: string): string | null => {
      if (isValidDate(value)) return value;
      report({ severity: "error", code: "BAD_DATE", line: lineNumber, value });
      return null;
    };

    if (current) {
      // Inside a voucher block only #TRANS counts.
      if (label === "#TRANS") {
        if (!need(2)) continue;
        const code = account(fields[0]);
        const ore = amount(fields[1]);
        if (code === null || ore === null) continue;
        const transDate = fields[2] && isValidDate(fields[2]) ? fields[2] : undefined;
        // Some programs leave transdat out altogether and put the text in its place.
        const transText = fields[3] || (fields[2] && !transDate ? fields[2] : "");
        const objects = rest.find((t) => t.kind === "list");
        current.lines.push({
          account: code,
          amountOre: ore,
          date: transDate,
          text: transText ? transText.trim() : undefined,
          hasObjects: objects !== undefined && objects.kind === "list" && objects.values.length > 0,
          line: lineNumber
        });
      }
      continue;
    }

    if (label !== "#VER") closePendingWithoutRows();

    switch (label) {
      case "#FLAGGA":
        doc.flag = fields[0] === undefined ? null : Number(fields[0]);
        break;
      case "#PROGRAM":
        doc.program = fields[0] ?? null;
        doc.programVersion = fields[1] ?? null;
        break;
      case "#FORMAT":
        doc.format = fields[0] ?? null;
        break;
      case "#GEN":
        doc.generated = fields[0] && isValidDate(fields[0]) ? fields[0] : null;
        break;
      case "#SIETYP":
        doc.sieType = fields[0] && /^\d+$/.test(fields[0]) ? Number(fields[0]) : null;
        break;
      case "#FNAMN":
        doc.companyName = fields[0] ?? null;
        break;
      case "#ORGNR":
        doc.orgNumber = fields[0] ?? null;
        break;
      case "#KPTYP":
        doc.accountPlanType = fields[0] ?? null;
        break;
      case "#VALUTA":
        doc.currency = fields[0] ? fields[0].toUpperCase() : null;
        break;
      case "#RAR": {
        if (!need(3)) break;
        if (!/^-?\d+$/.test(fields[0])) {
          report({ severity: "error", code: "BAD_YEAR_INDEX", line: lineNumber, value: fields[0] });
          break;
        }
        const start = date(fields[1]);
        const end = date(fields[2]);
        if (start && end) doc.fiscalYears.push({ index: Number(fields[0]), start, end, line: lineNumber });
        break;
      }
      case "#KONTO": {
        if (!need(1)) break;
        const code = account(fields[0]);
        if (code) doc.accounts.set(code, { code, name: (fields[1] ?? "").trim(), line: lineNumber });
        break;
      }
      case "#KTYP": {
        const type = (fields[1] ?? "").toUpperCase();
        const existing = fields[0] ? doc.accounts.get(fields[0]) : undefined;
        if (existing && (type === "T" || type === "S" || type === "K" || type === "I")) existing.type = type;
        break;
      }
      case "#IB":
      case "#UB":
      case "#RES": {
        if (!need(3)) break;
        if (!/^-?\d+$/.test(fields[0])) {
          report({ severity: "error", code: "BAD_YEAR_INDEX", line: lineNumber, value: fields[0] });
          break;
        }
        const code = account(fields[1]);
        const ore = amount(fields[2]);
        if (code === null || ore === null) break;
        const target = label === "#IB" ? doc.openingBalances : label === "#UB" ? doc.closingBalances : doc.results;
        target.push({ yearIndex: Number(fields[0]), account: code, amountOre: ore, line: lineNumber });
        break;
      }
      case "#VER": {
        closePendingWithoutRows();
        if (!need(3)) break;
        const verDate = date(fields[2]);
        if (!verDate) break;
        const voucher: SieVoucher = {
          series: fields[0],
          number: fields[1],
          date: verDate,
          text: (fields[3] ?? "").trim(),
          regDate: fields[4] && isValidDate(fields[4]) ? fields[4] : undefined,
          lines: [],
          line: lineNumber
        };
        // Tolerate "{" at the end of the #VER line instead of on its own line.
        if (rest.some((t) => t.kind === "open")) current = voucher;
        else pending = voucher;
        break;
      }
      case "#TRANS":
        report({ severity: "error", code: "TRANS_OUTSIDE_VER", line: lineNumber });
        break;
      default:
        // Unknown labels must be ignored (section 7.1).
        break;
    }
  }

  closePendingWithoutRows();
  if (current) {
    const open: SieVoucher = current;
    report({ severity: "error", code: "VER_NOT_CLOSED", line: open.line });
  }
  if (!sawLabel) report({ severity: "error", code: "NOT_SIE", line: 1 });

  doc.fiscalYears.sort((a, b) => b.index - a.index);
  return doc;
};
