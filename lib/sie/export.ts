/**
 * Writer for SIE type 4 export files (SIE4E).
 *
 * Record layouts follow "SIE filformat, utgåva 4B" (SIE-Gruppen, 2008-09-30),
 * https://sie.se/wp-content/uploads/2020/05/SIE_filformat_ver_4B_080930.pdf
 * See lib/sie/parse.ts for the list of records.
 *
 * What is written, in the order section 5.12 requires:
 *   1. #FLAGGA
 *   2. #PROGRAM #FORMAT #GEN #SIETYP #ORGNR #FNAMN #RAR #KPTYP #VALUTA
 *   3. #KONTO and #KTYP for every account in the chart
 *   4. #IB #UB #RES for the chosen year and, when it has figures, the year
 *      before; then every verification of the chosen year as #VER with #TRANS
 *
 * Not written: #SRU (Akunta holds no SRU codes per account), dimensions and
 * objects (Akunta has none) and the optional #KSUMMA checksum.
 *
 * Fiscal years are calendar years, as everywhere else in Akunta (see
 * lib/accounting/year-end.ts).
 */

import { Prisma } from "@prisma/client";

import { isBalanceSheetType, flipForAccountType, sieTypeFromAccountType } from "@/lib/sie/accountTypes";
import { encodeCp437, toCp437Text } from "@/lib/sie/cp437";
import { formatSieAmount, parseSieAmount } from "@/lib/sie/parse";

type Db = Prisma.TransactionClient;

export type SieExportDocument = {
  program: string;
  programVersion: string;
  /** YYYYMMDD */
  generated: string;
  companyName: string;
  orgNumber: string | null;
  currency: string;
  accountPlanType: string;
  fiscalYears: Array<{ index: number; start: string; end: string }>;
  accounts: Array<{ code: string; name: string; type: "T" | "S" | "K" | "I" }>;
  openingBalances: Array<{ yearIndex: number; account: string; amountOre: number }>;
  closingBalances: Array<{ yearIndex: number; account: string; amountOre: number }>;
  results: Array<{ yearIndex: number; account: string; amountOre: number }>;
  vouchers: Array<{
    series: string;
    number: string;
    date: string;
    text: string;
    regDate?: string;
    lines: Array<{ account: string; amountOre: number; text?: string }>;
  }>;
};

export class SieExportError extends Error {
  constructor(
    public readonly code: "BAD_YEAR" | "NO_BUSINESS",
    message: string
  ) {
    super(message);
    this.name = "SieExportError";
  }
}

/**
 * A text field, always quoted. Control characters are not allowed inside a
 * string (section 5.7) and become spaces; a quote is written \". The standard
 * defines no escape for the backslash itself, so a backslash that would be
 * read as the start of \" (one directly before a quote, or last in the field)
 * is written as a forward slash.
 */
const quote = (value: string): string => {
  const clean = toCp437Text(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\(?="|$)/g, "/")
    .replace(/"/g, '\\"');
  return `"${clean}"`;
};

export const renderSie = (doc: SieExportDocument): string => {
  const out: string[] = [];
  out.push("#FLAGGA 0");
  out.push(`#PROGRAM ${quote(doc.program)} ${quote(doc.programVersion)}`);
  out.push("#FORMAT PC8");
  out.push(`#GEN ${doc.generated}`);
  out.push("#SIETYP 4");
  if (doc.orgNumber) out.push(`#ORGNR ${doc.orgNumber}`);
  out.push(`#FNAMN ${quote(doc.companyName)}`);
  for (const year of doc.fiscalYears) out.push(`#RAR ${year.index} ${year.start} ${year.end}`);
  out.push(`#KPTYP ${doc.accountPlanType}`);
  out.push(`#VALUTA ${doc.currency}`);

  for (const account of doc.accounts) {
    out.push(`#KONTO ${account.code} ${quote(account.name)}`);
    out.push(`#KTYP ${account.code} ${account.type}`);
  }

  for (const row of doc.openingBalances) out.push(`#IB ${row.yearIndex} ${row.account} ${formatSieAmount(row.amountOre)}`);
  for (const row of doc.closingBalances) out.push(`#UB ${row.yearIndex} ${row.account} ${formatSieAmount(row.amountOre)}`);
  for (const row of doc.results) out.push(`#RES ${row.yearIndex} ${row.account} ${formatSieAmount(row.amountOre)}`);

  for (const voucher of doc.vouchers) {
    const regDate = voucher.regDate ? ` ${voucher.regDate}` : "";
    out.push(`#VER ${quote(voucher.series)} ${quote(voucher.number)} ${voucher.date} ${quote(voucher.text)}${regDate}`);
    out.push("{");
    for (const line of voucher.lines) {
      // transtext comes after transdat, so the date is written whenever there is a text.
      const text = line.text ? ` ${voucher.date} ${quote(line.text)}` : "";
      out.push(`   #TRANS ${line.account} {} ${formatSieAmount(line.amountOre)}${text}`);
    }
    out.push("}");
  }

  // Section 5.5: every record ends with a line feed; a carriage return before it is allowed.
  return out.join("\r\n") + "\r\n";
};

const toOre = (value: Prisma.Decimal | null | undefined): number =>
  value ? (parseSieAmount(new Prisma.Decimal(value).toFixed(2)) ?? 0) : 0;

const ymd = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

const yearStart = (year: number) => new Date(Date.UTC(year, 0, 1));
const yearEnd = (year: number) => new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

/**
 * #ORGNR must have a hyphen after the sixth digit. A sole trader's
 * organisation number is the personal identity number, which may be stored
 * with a century prefix.
 */
const normaliseOrgNumber = (value: string | null | undefined): string | null => {
  const digits = (value ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 ? digits.slice(2) : digits;
  return ten.length === 10 ? `${ten.slice(0, 6)}-${ten.slice(6)}` : null;
};

type AccountRow = { id: string; code: string; name: string; type: string };

/** Debit minus credit per account for verifications dated inside the range. */
const movementsByAccount = async (
  db: Db,
  businessId: string,
  range: { gte?: Date; lte?: Date; lt?: Date }
): Promise<Map<string, number>> => {
  const groups = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { transaction: { businessId, txnDate: range } },
    _sum: { debit: true, credit: true }
  });
  return new Map(groups.map((group) => [group.accountId, toOre(group._sum.debit) - toOre(group._sum.credit)]));
};

type YearFigures = {
  /** Debit-positive öre per account id. */
  opening: Map<string, number>;
  closing: Map<string, number>;
  result: Map<string, number>;
};

/**
 * Opening balances, closing balances and results for one calendar year,
 * debit-positive as SIE wants them.
 *
 * Opening balances come from the stored OpeningBalance rows when the year has
 * any (written by the year-end close, by hand or by a SIE import). Otherwise
 * they are everything booked before the year, with the accumulated result of
 * those earlier years added to equity account 2010, which is what closing the
 * years would have done. Either way the opening balances sum to zero.
 */
const figuresForYear = async (
  db: Db,
  businessId: string,
  year: number,
  accounts: AccountRow[]
): Promise<YearFigures> => {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const opening = new Map<string, number>();

  const stored = await db.openingBalance.findMany({ where: { businessId, fiscalYear: year } });
  if (stored.length > 0) {
    for (const row of stored) {
      const account = byId.get(row.accountId);
      if (!account || !isBalanceSheetType(account.type)) continue;
      opening.set(account.id, flipForAccountType(account.type, toOre(row.amount)));
    }
  } else {
    const earlier = await movementsByAccount(db, businessId, { lt: yearStart(year) });
    let earlierResult = 0;
    for (const [accountId, ore] of earlier) {
      const account = byId.get(accountId);
      if (!account) continue;
      if (isBalanceSheetType(account.type)) opening.set(accountId, ore);
      else earlierResult += ore;
    }
    const equity = accounts.find((account) => account.code === "2010");
    if (equity && earlierResult !== 0) opening.set(equity.id, (opening.get(equity.id) ?? 0) + earlierResult);
  }

  const during = await movementsByAccount(db, businessId, { gte: yearStart(year), lte: yearEnd(year) });
  const closing = new Map(opening);
  const result = new Map<string, number>();
  for (const [accountId, ore] of during) {
    const account = byId.get(accountId);
    if (!account) continue;
    if (isBalanceSheetType(account.type)) closing.set(accountId, (closing.get(accountId) ?? 0) + ore);
    else result.set(accountId, ore);
  }
  return { opening, closing, result };
};

export const buildSieExportDocument = async (
  db: Db,
  params: { businessId: string; year: number; now?: Date }
): Promise<SieExportDocument> => {
  const { businessId, year } = params;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new SieExportError("BAD_YEAR", `Not a valid fiscal year: ${year}`);
  }
  const business = await db.business.findUnique({ where: { id: businessId } });
  if (!business) throw new SieExportError("NO_BUSINESS", "Business not found.");

  const accounts = await db.account.findMany({
    where: { businessId },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" }
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));

  const current = await figuresForYear(db, businessId, year, accounts);
  const previous = await figuresForYear(db, businessId, year - 1, accounts);
  const hasPrevious = [previous.opening, previous.closing, previous.result].some((map) =>
    [...map.values()].some((ore) => ore !== 0)
  );

  const rows = (map: Map<string, number>, yearIndex: number) =>
    [...map.entries()]
      .filter(([, ore]) => ore !== 0)
      .map(([accountId, ore]) => ({ yearIndex, account: byId.get(accountId)?.code ?? "", amountOre: ore }))
      .filter((row) => row.account !== "")
      .sort((a, b) => a.account.localeCompare(b.account));

  // Cancelled verifications and their corrections are both real verifications
  // and both belong in the file, so there is no filter on voidedAt here.
  const transactions = await db.transaction.findMany({
    where: { businessId, txnDate: { gte: yearStart(year), lte: yearEnd(year) } },
    include: { lines: true },
    orderBy: { verificationNumber: "asc" }
  });

  return {
    program: "Akunta",
    programVersion: "1.0",
    generated: ymd(params.now ?? new Date()),
    companyName: business.name,
    orgNumber: normaliseOrgNumber(business.invoiceSenderOrgNumber) ?? normaliseOrgNumber(business.personnummer),
    currency: business.baseCurrency || "SEK",
    // Akunta's chart follows the current BAS structure, which SIE calls EUBAS97
    // (the specification says any BAS2xxx chart is to be treated as EUBAS97).
    accountPlanType: "EUBAS97",
    fiscalYears: [
      { index: 0, start: `${year}0101`, end: `${year}1231` },
      ...(hasPrevious ? [{ index: -1, start: `${year - 1}0101`, end: `${year - 1}1231` }] : [])
    ],
    accounts: accounts.map((account) => ({
      code: account.code,
      name: account.name,
      type: sieTypeFromAccountType(account.type)
    })),
    openingBalances: [...rows(current.opening, 0), ...(hasPrevious ? rows(previous.opening, -1) : [])],
    closingBalances: [...rows(current.closing, 0), ...(hasPrevious ? rows(previous.closing, -1) : [])],
    results: [...rows(current.result, 0), ...(hasPrevious ? rows(previous.result, -1) : [])],
    vouchers: transactions.map((transaction) => ({
      series: "A",
      number: String(transaction.verificationNumber),
      date: ymd(transaction.txnDate),
      text: transaction.description,
      regDate: ymd(transaction.createdAt),
      lines: transaction.lines
        .map((line) => ({
          account: byId.get(line.accountId)?.code ?? "",
          amountOre: toOre(line.debit) - toOre(line.credit),
          // "counterparty_bank" is an internal marker used when rebalancing, not text for an accountant.
          text: line.note && line.note !== "counterparty_bank" ? line.note : undefined
        }))
        .filter((line) => line.account !== "" && line.amountOre !== 0)
    }))
  };
};

export const buildSieExport = async (
  db: Db,
  params: { businessId: string; year: number; now?: Date }
): Promise<{ bytes: Uint8Array; fileName: string; document: SieExportDocument }> => {
  const document = await buildSieExportDocument(db, params);
  const slug =
    document.companyName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "akunta";
  return { bytes: encodeCp437(renderSie(document)), fileName: `${slug}-${params.year}.se`, document };
};
