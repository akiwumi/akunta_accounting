/**
 * NE-bilaga (blankett SKV 2161, "Inkomst av näringsverksamhet – Enskilda
 * näringsidkare") computed from the ledger.
 *
 * Box layout and numbering follow the current form, as published in
 * Skatteverket's field-name table NE_SKV2161-14-02-26-02 (2026P4; the NE boxes
 * are unchanged from 2024P4 and 2025P4) and the guidance "Fylla i NE-bilagan":
 *   https://www.skatteverket.se/fyllainebilagan
 *   .../fyllainebilagan/balansochresultatrakning.4.361dc8c15312eff6fd2c7ac.html
 *   .../fyllainebilagan/skattemassigajusteringar.4.361dc8c15312eff6fd2c7d1.html
 *   .../fyllainebilagan/ovrigauppgifter.4.361dc8c15312eff6fd2c8bb.html
 *
 * Accounts are mapped to boxes with BAS's kopplingstabell for sole traders who
 * prepare a förenklat årsbokslut (NE_K1), completed with the interval table
 * (NE_EJ_K1) for accounts the K1 chart does not have:
 *   https://www.bas.se/kontoplaner/sru/
 *
 * Conventions
 *   - Fiscal years are calendar years, as in lib/accounting/year-end.ts.
 *   - Amounts are whole kronor, as the form requires. Every box is rounded
 *     first and the sum boxes add the rounded figures, so the form adds up.
 *   - A box carries the sign convention of the form: costs and deductions are
 *     positive numbers in boxes the form prints with a minus sign.
 *   - Reversing entries (cancelled verifications) carry swapped journal lines,
 *     so summing lines by account nets them out with no special handling.
 *   - A box the data cannot answer has amount null ("fill in yourself"). It
 *     counts as blank in the sums until the user enters a figure.
 */

import { asNumber, round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { AccountTypes } from "@/lib/domain/enums";
import { calculateTotalDepreciation, type FixedAssetInput } from "@/lib/tax/depreciation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NeSection = "balance" | "income" | "adjustments" | "other";

/** ledger: summed from accounts. computed: from registers in the app. sum: a subtotal. manual: only the user knows. */
export type NeBoxKind = "ledger" | "computed" | "sum" | "manual";

export type NeAccountLine = { code: string; name: string; amount: number };

export type NeBoxPart = { key: string; amount: number };

export type NeBox = {
  id: string;
  section: NeSection;
  kind: NeBoxKind;
  /** Sign printed on the form: "+" added, "-" deducted, "*" none (the amount carries its own sign). */
  sign: "+" | "-" | "*";
  /** Whole kronor. null = not known, fill in yourself. */
  amount: number | null;
  /** True when a figure entered by the user is part of the amount. */
  entered: boolean;
  /** Accounts behind a ledger box, in the sign convention of the box. */
  accounts: NeAccountLine[];
  /** Components of a computed box (for example depreciation and mileage in R16). */
  parts: NeBoxPart[];
};

export type NeWarning = { code: string; params: Record<string, string | number> };

/** Boxes the user may fill in. All are zero or positive; the form supplies the sign. */
export const NE_MANUAL_BOX_IDS = [
  "R13",
  "R14",
  "R15",
  "R16",
  "R18",
  "R19",
  "R20a",
  "R20b",
  "R22",
  "R23",
  "R24",
  "R25",
  "R26",
  "R27",
  "R28",
  "R30",
  "R31",
  "R38",
  "R40",
  "R41",
  "R44",
  "R45",
  "R46"
] as const;

export type NeManualBoxId = (typeof NE_MANUAL_BOX_IDS)[number];
export type NeManualInputs = Partial<Record<NeManualBoxId, number>>;

export type NeBilagaOptions = {
  manual?: NeManualInputs;
  /** Year of birth of the owner, used for the rate of the egenavgifter deduction in R43. */
  birthYear?: number | null;
  /** Business is registered for VAT. When false all sales go to R2 (momsfria intäkter). */
  vatRegistered?: boolean;
};

export type NeFacts = {
  /** This year's depreciation according to the asset register. */
  registerDepreciation: number;
  /** Depreciation booked in the ledger (R9 + R10). */
  bookedDepreciation: number;
  unbookedDepreciation: number;
  fixedAssetCount: number;
  disposalsThisYear: number;
  registerNetBookValue: number;
  mileageDeduction: number;
  bookedMileage: number;
  unbookedMileage: number;
  pfWithdrawal: number;
  pfAllocationRequested: number;
  pfAllocationMax: number;
  pfAllocation: number;
  efWithdrawal: number;
  efAllocationRequested: number;
  efAllocation: number;
  /** Rate used for R43 and whether it was assumed rather than derived from the year of birth. */
  egenavgifterDeductionRate: number;
  egenavgifterRateAssumed: boolean;
  /** Assets minus liabilities minus equity and result, unrounded. Zero when the books balance. */
  balanceDifference: number;
  bankBalance: number;
};

export type NeBilaga = {
  incomeYear: number;
  periodStart: string;
  periodEnd: string;
  boxes: NeBox[];
  /** R11, whole kronor. */
  bookedResult: number;
  /** Final result: positive = surplus (R47), negative = deficit (R48). */
  result: number;
  /** Manual boxes without a figure. */
  fillInYourself: string[];
  warnings: NeWarning[];
  facts: NeFacts;
};

// ─── Account → box mapping ────────────────────────────────────────────────────

const BALANCE_BOXES = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16"];
const ASSET_BOXES = new Set(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"]);
const INCOME_BOXES = ["R1", "R2", "R3", "R4"];
const COST_BOXES = ["R5", "R6", "R7", "R8", "R9", "R10"];

const between = (n: number, from: number, to: number) => n >= from && n <= to;

/**
 * Balance sheet box for an account. `fallback` is true when the code is outside
 * every range in the BAS tables and the account type decided instead.
 */
export const balanceBoxForAccount = (code: string, type: string, name = ""): { box: string; fallback: boolean } => {
  const n = /^\d{4}/.test(code) ? Number(code.slice(0, 4)) : NaN;
  if (!Number.isNaN(n)) {
    if (between(n, 1000, 1099)) return { box: "B1", fallback: false };
    if (between(n, 1130, 1149) || between(n, 1180, 1189) || n === 1291) return { box: "B3", fallback: false };
    if (between(n, 1100, 1199)) return { box: "B2", fallback: false };
    if (between(n, 1200, 1299)) return { box: "B4", fallback: false };
    if (between(n, 1300, 1399)) return { box: "B5", fallback: false };
    if (between(n, 1400, 1499)) return { box: "B6", fallback: false };
    if (between(n, 1500, 1599)) return { box: "B7", fallback: false };
    if (between(n, 1600, 1899)) return { box: "B8", fallback: false };
    if (between(n, 1900, 1999)) return { box: "B9", fallback: false };
    if (between(n, 2000, 2099)) return { box: "B10", fallback: false };
    // Akunta's default chart seeds 2100 as "Skulder till kreditinstitut" (a loan), where BAS has
    // obeskattade reserver in 21xx. Go by what the account is.
    if (between(n, 2100, 2199) && /kreditinstitut|bank loan|\blån\b/i.test(name)) return { box: "B13", fallback: false };
    if (between(n, 2100, 2199)) return { box: "B11", fallback: false };
    if (between(n, 2200, 2299)) return { box: "B12", fallback: false };
    if (between(n, 2300, 2399) || between(n, 2410, 2419) || between(n, 2480, 2489)) return { box: "B13", fallback: false };
    if (between(n, 2440, 2449) || between(n, 2460, 2479)) return { box: "B15", fallback: false };
    // NE_K1: VAT (26xx), personalskatt (2710) and sociala avgifter (2730) are skatteskulder.
    if (between(n, 2500, 2699) || between(n, 2710, 2719) || between(n, 2730, 2739)) return { box: "B14", fallback: false };
    if (between(n, 2400, 2999)) return { box: "B16", fallback: false };
  }
  if (type === AccountTypes.ASSET) return { box: "B8", fallback: true };
  if (type === AccountTypes.EQUITY) return { box: "B10", fallback: true };
  return { box: "B16", fallback: true };
};

/** Income statement box for an account. */
export const resultBoxForAccount = (
  code: string,
  type: string,
  vatRegistered = true
): { box: string; fallback: boolean } => {
  const n = /^\d{4}/.test(code) ? Number(code.slice(0, 4)) : NaN;
  if (!Number.isNaN(n)) {
    if (between(n, 3000, 3999)) {
      if (between(n, 3200, 3299)) return { box: "R3", fallback: false };
      // Momsfria intäkter: 31xx, grants, insurance compensation, gains on disposals (NE_K1),
      // and Akunta's own 3051 "Försäljning utan moms".
      const vatFree =
        between(n, 3100, 3199) || n === 3051 || between(n, 3910, 3929) || between(n, 3970, 3989);
      return { box: vatFree || !vatRegistered ? "R2" : "R1", fallback: false };
    }
    if (between(n, 4000, 4999)) return { box: "R5", fallback: false };
    if (between(n, 5000, 6999)) return { box: "R6", fallback: false };
    if (between(n, 7000, 7699)) return { box: "R7", fallback: false };
    if (between(n, 7720, 7729) || between(n, 7770, 7779) || between(n, 7820, 7829) || between(n, 7840, 7849)) {
      return { box: "R9", fallback: false };
    }
    if (
      between(n, 7700, 7719) ||
      between(n, 7730, 7739) ||
      between(n, 7760, 7769) ||
      between(n, 7780, 7789) ||
      between(n, 7810, 7819) ||
      between(n, 7830, 7839) ||
      between(n, 7980, 7989)
    ) {
      return { box: "R10", fallback: false };
    }
    if (between(n, 7740, 7749) || between(n, 7790, 7799) || between(n, 7900, 7999)) return { box: "R8", fallback: false };
    if (between(n, 8000, 8999)) return { box: type === AccountTypes.INCOME ? "R4" : "R8", fallback: false };
  }
  return { box: type === AccountTypes.INCOME ? "R1" : "R6", fallback: true };
};

// ─── Ledger ───────────────────────────────────────────────────────────────────

type LedgerAccount = {
  code: string;
  name: string;
  type: string;
  /** Debit minus credit for the year. */
  yearNet: number;
  /** Debit minus credit carried in from before the year (opening balance, or all earlier entries). */
  priorNet: number;
};

const isResultAccount = (type: string) => type === AccountTypes.INCOME || type === AccountTypes.EXPENSE;
const isDebitNormal = (type: string) => type === AccountTypes.ASSET || type === AccountTypes.EXPENSE;

/**
 * One row per account with the year's movement and what was carried in.
 * Mirrors buildBalanceSheet: if the year has opening balances they are the
 * starting point, otherwise every earlier entry is counted.
 */
const loadLedger = async (businessId: string, year: number): Promise<LedgerAccount[]> => {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const [accounts, openingRows, yearSums] = await Promise.all([
    prisma.account.findMany({ where: { businessId }, select: { id: true, code: true, name: true, type: true } }),
    prisma.openingBalance.findMany({ where: { businessId, fiscalYear: year }, select: { accountId: true, amount: true } }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { transaction: { businessId, txnDate: { gte: yearStart, lte: yearEnd } } },
      _sum: { debit: true, credit: true }
    })
  ]);

  const priorSums =
    openingRows.length > 0
      ? []
      : await prisma.journalLine.groupBy({
          by: ["accountId"],
          where: { transaction: { businessId, txnDate: { lt: yearStart } } },
          _sum: { debit: true, credit: true }
        });

  const net = (row: { _sum: { debit: unknown; credit: unknown } }) =>
    round2(asNumber(row._sum.debit ?? 0) - asNumber(row._sum.credit ?? 0));
  const yearById = new Map(yearSums.map((row) => [row.accountId, net(row)]));
  const priorById = new Map(priorSums.map((row) => [row.accountId, net(row)]));
  const openingById = new Map(openingRows.map((row) => [row.accountId, asNumber(row.amount)]));

  return accounts
    .map((account) => {
      // Opening balances are stored in the natural sign of the account type.
      const opening = openingById.get(account.id);
      const priorNet =
        opening !== undefined ? (isDebitNormal(account.type) ? opening : -opening) : (priorById.get(account.id) ?? 0);
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        yearNet: yearById.get(account.id) ?? 0,
        priorNet: round2(priorNet)
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
};

// ─── Rates ────────────────────────────────────────────────────────────────────

/**
 * Schablonavdrag for egenavgifter (R43), active business.
 * https://www.skatteverket.se/foretag/drivaforetag/foretagsformer/enskildnaringsverksamhet/egenavgifterochsarskildloneskatt.4.361dc8c15312eff6fd1f678.html
 * Income years 2025 and 2026: born 1959 or later 25 %, born 1938–1958 10 %, born 1937 or earlier 0 %.
 */
const EGENAVGIFTER_DEDUCTION: Record<number, { fullFrom: number; reducedFrom: number }> = {
  2025: { fullFrom: 1959, reducedFrom: 1938 },
  2026: { fullFrom: 1959, reducedFrom: 1938 }
};

export const egenavgifterDeductionRate = (
  incomeYear: number,
  birthYear: number | null | undefined
): { rate: number; assumed: boolean } => {
  const table = EGENAVGIFTER_DEDUCTION[incomeYear];
  if (!table || !birthYear) return { rate: 0.25, assumed: true };
  if (birthYear >= table.fullFrom) return { rate: 0.25, assumed: false };
  if (birthYear >= table.reducedFrom) return { rate: 0.1, assumed: false };
  return { rate: 0, assumed: false };
};

/** Särskild löneskatt on pension savings deducted in R38 (R39). */
const SPECIAL_PAYROLL_TAX_RATE = 0.2426;
/** Allocation to periodiseringsfond: at most 30 % of R33. */
const PERIODISERINGSFOND_MAX_SHARE = 0.3;

// ─── Computation ──────────────────────────────────────────────────────────────

const kr = (value: number) => {
  const rounded = Math.round(round2(value));
  return rounded === 0 ? 0 : rounded;
};

const cleanManual = (manual: NeManualInputs | undefined): NeManualInputs => {
  const out: NeManualInputs = {};
  for (const id of NE_MANUAL_BOX_IDS) {
    const value = manual?.[id];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[id] = Math.round(value);
  }
  return out;
};

export const buildNeBilaga = async (
  businessId: string,
  incomeYear: number,
  options: NeBilagaOptions = {}
): Promise<NeBilaga> => {
  const yearStart = new Date(Date.UTC(incomeYear, 0, 1));
  const yearEnd = new Date(Date.UTC(incomeYear, 11, 31, 23, 59, 59, 999));
  const vatRegistered = options.vatRegistered ?? true;
  const manual = cleanManual(options.manual);
  const warnings: NeWarning[] = [];

  const [ledger, assets, periodEntries, mileageEntries] = await Promise.all([
    loadLedger(businessId, incomeYear),
    prisma.fixedAsset.findMany({ where: { businessId } }),
    prisma.periodisationEntry.findMany({ where: { businessId, taxYear: incomeYear } }),
    prisma.mileageEntry.findMany({
      where: { businessId, tripDate: { gte: yearStart, lte: yearEnd } },
      select: { deductionAmount: true }
    })
  ]);

  const exact = new Map<string, number>();
  const lines = new Map<string, NeAccountLine[]>();
  const add = (box: string, line: NeAccountLine) => {
    if (line.amount === 0) return;
    exact.set(box, round2((exact.get(box) ?? 0) + line.amount));
    lines.set(box, [...(lines.get(box) ?? []), line]);
  };

  // ── Income statement R1–R10 ───────────────────────────────────────────────
  let earlierResult = 0; // result of earlier years that no year-end close has moved to equity
  for (const account of ledger) {
    if (!isResultAccount(account.type)) continue;
    earlierResult = round2(earlierResult - account.priorNet);
    if (account.yearNet === 0) continue;
    const { box, fallback } = resultBoxForAccount(account.code, account.type, vatRegistered);
    if (fallback) warnings.push({ code: "unmappedAccount", params: { account: `${account.code} ${account.name}`, box } });
    const isIncomeBox = INCOME_BOXES.includes(box);
    add(box, { code: account.code, name: account.name, amount: isIncomeBox ? round2(-account.yearNet) : account.yearNet });
    if (/^757/.test(account.code)) warnings.push({ code: "egenavgifterBooked", params: { amount: kr(account.yearNet) } });
  }

  // ── Balance sheet B1–B16 at year end ──────────────────────────────────────
  const balanceAccounts = ledger
    .filter((account) => !isResultAccount(account.type))
    .map((account) => ({ ...account, closing: round2(account.priorNet + account.yearNet) }))
    .filter((account) => account.closing !== 0);

  // VAT accounts are netted. A net claim on Skatteverket is a receivable (B8), not a negative debt.
  const vatNetDebit = round2(
    balanceAccounts.filter((account) => /^26/.test(account.code)).reduce((sum, account) => sum + account.closing, 0)
  );

  let equityAccountsExact = 0;
  for (const account of balanceAccounts) {
    const mapped = balanceBoxForAccount(account.code, account.type, account.name);
    const { fallback } = mapped;
    const box = /^26/.test(account.code) && vatNetDebit > 0 ? "B8" : mapped.box;
    if (fallback) warnings.push({ code: "unmappedAccount", params: { account: `${account.code} ${account.name}`, box } });
    if (box === "B11") warnings.push({ code: "untaxedReserveBooked", params: { account: `${account.code} ${account.name}` } });
    const amount = ASSET_BOXES.has(box) ? account.closing : round2(-account.closing);
    if (box === "B10") equityAccountsExact = round2(equityAccountsExact + amount);
    add(box, { code: account.code, name: account.name, amount });
  }

  const resultExact = round2(
    INCOME_BOXES.reduce((sum, id) => sum + (exact.get(id) ?? 0), 0) - COST_BOXES.reduce((sum, id) => sum + (exact.get(id) ?? 0), 0)
  );
  const assetsExact = round2([...ASSET_BOXES].reduce((sum, id) => sum + (exact.get(id) ?? 0), 0));
  const debtsExact = round2(
    ["B11", "B12", "B13", "B14", "B15", "B16"].reduce((sum, id) => sum + (exact.get(id) ?? 0), 0)
  );
  const equityExact = round2(equityAccountsExact + earlierResult + resultExact);
  const balanceDifference = round2(assetsExact - debtsExact - equityExact);
  if (balanceDifference !== 0) warnings.push({ code: "balanceDiffers", params: { amount: balanceDifference } });

  const amounts = new Map<string, number | null>();
  for (const id of [...BALANCE_BOXES, ...INCOME_BOXES, ...COST_BOXES]) amounts.set(id, kr(exact.get(id) ?? 0));
  const get = (id: string) => amounts.get(id) ?? 0;

  // B10 is what the form says it is: assets minus liabilities, in whole kronor.
  amounts.set(
    "B10",
    ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"].reduce((sum, id) => sum + get(id), 0) -
      ["B11", "B12", "B13", "B14", "B15", "B16"].reduce((sum, id) => sum + get(id), 0)
  );
  const equityLines: NeAccountLine[] = [...(lines.get("B10") ?? [])];
  if (earlierResult !== 0) equityLines.push({ code: "", name: "earlierResult", amount: earlierResult });
  if (resultExact !== 0) equityLines.push({ code: "", name: "yearResult", amount: resultExact });
  lines.set("B10", equityLines);

  const R11 = INCOME_BOXES.reduce((sum, id) => sum + get(id), 0) - COST_BOXES.reduce((sum, id) => sum + get(id), 0);
  amounts.set("R11", R11);

  // ── Registers ─────────────────────────────────────────────────────────────
  const assetInputs: FixedAssetInput[] = assets.map((asset) => ({
    id: asset.id,
    description: asset.description,
    category: asset.category,
    acquisitionDate: asset.acquisitionDate,
    acquisitionCost: asNumber(asset.acquisitionCost),
    depreciationMethod: asset.depreciationMethod,
    disposalDate: asset.disposalDate ?? null,
    disposalValue: asset.disposalValue ? asNumber(asset.disposalValue) : null
  }));
  const depreciation = calculateTotalDepreciation(assetInputs, incomeYear);
  const registerDepreciation = round2(depreciation.totalYearDepreciation);
  const bookedDepreciation = round2((exact.get("R9") ?? 0) + (exact.get("R10") ?? 0));
  const unbookedDepreciation = kr(Math.max(0, registerDepreciation - bookedDepreciation));
  const disposalsThisYear = assets.filter((asset) => asset.disposalDate?.getFullYear() === incomeYear).length;
  const registerNetBookValue = round2(
    depreciation.details.filter((detail) => !detail.isDisposed).reduce((sum, detail) => sum + detail.netBookValue, 0)
  );
  if (disposalsThisYear > 0) warnings.push({ code: "assetDisposed", params: { count: disposalsThisYear } });
  if (unbookedDepreciation > 0) warnings.push({ code: "depreciationNotBooked", params: { amount: unbookedDepreciation } });

  const mileageDeduction = round2(mileageEntries.reduce((sum, entry) => sum + asNumber(entry.deductionAmount), 0));
  const bookedMileage = round2(
    ledger.filter((account) => account.code === "5810").reduce((sum, account) => sum + account.yearNet, 0)
  );
  const unbookedMileage = kr(Math.max(0, mileageDeduction - bookedMileage));

  const sumEntries = (entryType: string, direction: string) =>
    round2(
      periodEntries
        .filter((entry) => entry.entryType === entryType && entry.direction === direction)
        .reduce((sum, entry) => sum + asNumber(entry.amount), 0)
    );
  const pfWithdrawal = kr(sumEntries("periodiseringsfond", "withdrawal"));
  const pfAllocationRequested = kr(sumEntries("periodiseringsfond", "allocation"));
  const efWithdrawal = kr(sumEntries("expansionsfond", "withdrawal"));
  const efAllocationRequested = kr(sumEntries("expansionsfond", "allocation"));

  // ── Tax adjustments R12–R48 ───────────────────────────────────────────────
  const m = (id: NeManualBoxId) => manual[id] ?? 0;
  const parts = new Map<string, NeBoxPart[]>();

  amounts.set("R12", R11);
  for (const id of NE_MANUAL_BOX_IDS) amounts.set(id, manual[id] ?? null);

  const r16Parts: NeBoxPart[] = [];
  if (unbookedDepreciation > 0) r16Parts.push({ key: "depreciation", amount: unbookedDepreciation });
  if (unbookedMileage > 0) r16Parts.push({ key: "mileage", amount: unbookedMileage });
  if (manual.R16 !== undefined && manual.R16 > 0) r16Parts.push({ key: "entered", amount: manual.R16 });
  const R16 = unbookedDepreciation + unbookedMileage + m("R16");
  amounts.set("R16", R16);
  parts.set("R16", r16Parts);

  const R17 = R11 + m("R13") - m("R14") + m("R15") - R16;
  amounts.set("R17", R17);
  const R21 = R17 - m("R18") + m("R19") + m("R20a") - m("R20b");
  amounts.set("R21", R21);
  const R29 = R21 - m("R22") + m("R23") - m("R24") - m("R25") + m("R26") + m("R27") - m("R28");
  amounts.set("R29", R29);

  amounts.set("R32", pfWithdrawal);
  const R33 = R29 - m("R30") + m("R31") + pfWithdrawal;
  amounts.set("R33", R33);

  const pfAllocationMax = Math.max(0, Math.floor(R33 * PERIODISERINGSFOND_MAX_SHARE));
  const pfAllocation = Math.min(pfAllocationRequested, pfAllocationMax);
  if (pfAllocationRequested > pfAllocationMax) {
    warnings.push({ code: "pfCapped", params: { requested: pfAllocationRequested, max: pfAllocationMax } });
  }
  amounts.set("R34", pfAllocation);
  const R35 = R33 - pfAllocation;
  amounts.set("R35", R35);

  const efAllocation = Math.min(efAllocationRequested, Math.max(0, R35));
  if (efAllocationRequested > efAllocation) {
    warnings.push({ code: "efCapped", params: { requested: efAllocationRequested, max: efAllocation } });
  }
  if (efAllocationRequested > 0 || efWithdrawal > 0) warnings.push({ code: "expansionsfondInk1", params: {} });
  amounts.set("R36", efAllocation);
  amounts.set("R37", efWithdrawal);

  const R39 = manual.R38 !== undefined ? Math.round(manual.R38 * SPECIAL_PAYROLL_TAX_RATE) : 0;
  amounts.set("R39", R39);

  const R42 = R35 - efAllocation + efWithdrawal - m("R38") - R39 + m("R40") - m("R41");
  amounts.set("R42", R42);

  const { rate, assumed } = egenavgifterDeductionRate(incomeYear, options.birthYear);
  const R43 = R42 > 0 ? Math.floor(R42 * rate) : 0;
  amounts.set("R43", R43);
  if (assumed) warnings.push({ code: "egenavgifterRateAssumed", params: {} });

  const result = R42 - R43 + m("R44") + m("R45") + m("R46");
  amounts.set("R47", result > 0 ? result : 0);
  amounts.set("R48", result < 0 ? -result : 0);

  // ── Övriga uppgifter ──────────────────────────────────────────────────────
  amounts.set("O2", kr(mileageDeduction));

  // ── Assemble ──────────────────────────────────────────────────────────────
  const box = (id: string, section: NeSection, kind: NeBoxKind, sign: NeBox["sign"]): NeBox => ({
    id,
    section,
    kind,
    sign,
    amount: amounts.has(id) ? (amounts.get(id) ?? null) : null,
    entered: (NE_MANUAL_BOX_IDS as readonly string[]).includes(id) && manual[id as NeManualBoxId] !== undefined,
    accounts: lines.get(id) ?? [],
    parts: parts.get(id) ?? []
  });

  const boxes: NeBox[] = [
    ...BALANCE_BOXES.map((id) => box(id, "balance", id === "B10" ? "sum" : "ledger", "*")),
    ...INCOME_BOXES.map((id) => box(id, "income", "ledger", "+")),
    ...COST_BOXES.map((id) => box(id, "income", "ledger", "-")),
    box("R11", "income", "sum", "*"),
    box("R12", "adjustments", "sum", "*"),
    box("R13", "adjustments", "manual", "+"),
    box("R14", "adjustments", "manual", "-"),
    box("R15", "adjustments", "manual", "+"),
    box("R16", "adjustments", "computed", "-"),
    box("R17", "adjustments", "sum", "*"),
    box("R18", "adjustments", "manual", "-"),
    box("R19", "adjustments", "manual", "+"),
    box("R20a", "adjustments", "manual", "+"),
    box("R20b", "adjustments", "manual", "-"),
    box("R21", "adjustments", "sum", "*"),
    box("R22", "adjustments", "manual", "-"),
    box("R23", "adjustments", "manual", "+"),
    box("R24", "adjustments", "manual", "-"),
    box("R25", "adjustments", "manual", "-"),
    box("R26", "adjustments", "manual", "+"),
    box("R27", "adjustments", "manual", "+"),
    box("R28", "adjustments", "manual", "-"),
    box("R29", "adjustments", "sum", "*"),
    box("R30", "adjustments", "manual", "-"),
    box("R31", "adjustments", "manual", "+"),
    box("R32", "adjustments", "computed", "+"),
    box("R33", "adjustments", "sum", "*"),
    box("R34", "adjustments", "computed", "-"),
    box("R35", "adjustments", "sum", "*"),
    box("R36", "adjustments", "computed", "-"),
    box("R37", "adjustments", "computed", "+"),
    box("R38", "adjustments", "manual", "-"),
    box("R39", "adjustments", "computed", "-"),
    box("R40", "adjustments", "manual", "+"),
    box("R41", "adjustments", "manual", "-"),
    box("R42", "adjustments", "sum", "*"),
    box("R43", "adjustments", "computed", "-"),
    box("R44", "adjustments", "manual", "+"),
    box("R45", "adjustments", "manual", "+"),
    box("R46", "adjustments", "manual", "+"),
    box("R47", "adjustments", "sum", "+"),
    box("R48", "adjustments", "sum", "-"),
    box("O2", "other", "computed", "*")
  ];

  // R16 is computed from the registers, but the user may add to it. It is never "fill in yourself".
  const fillInYourself = boxes
    .filter((item) => item.kind === "manual" && item.amount === null)
    .map((item) => item.id);

  const bankBalance = round2((lines.get("B9") ?? []).reduce((sum, line) => sum + line.amount, 0));

  return {
    incomeYear,
    periodStart: `${incomeYear}-01-01`,
    periodEnd: `${incomeYear}-12-31`,
    boxes,
    bookedResult: R11,
    result,
    fillInYourself,
    warnings,
    facts: {
      registerDepreciation,
      bookedDepreciation,
      unbookedDepreciation,
      fixedAssetCount: assets.length,
      disposalsThisYear,
      registerNetBookValue,
      mileageDeduction,
      bookedMileage,
      unbookedMileage,
      pfWithdrawal,
      pfAllocationRequested,
      pfAllocationMax,
      pfAllocation,
      efWithdrawal,
      efAllocationRequested,
      efAllocation,
      egenavgifterDeductionRate: rate,
      egenavgifterRateAssumed: assumed,
      balanceDifference,
      bankBalance
    }
  };
};

export const neBox = (ne: NeBilaga, id: string): NeBox => {
  const found = ne.boxes.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown NE box ${id}`);
  return found;
};

/** Amount of a box, with blank boxes read as zero. */
export const neAmount = (ne: NeBilaga, id: string): number => neBox(ne, id).amount ?? 0;
