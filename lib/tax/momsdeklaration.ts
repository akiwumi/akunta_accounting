/**
 * The VAT return (momsdeklaration) per box, the checks around it, the file
 * for Skatteverket's e-service and the record of a filed return.
 *
 * Box definitions, read 2026-11-15:
 * https://skatteverket.se/foretag/moms/deklareramoms/fyllaimomsdeklarationen.4.3a2a542410ab40a421c80004214.html
 *   05  taxable sales in Sweden, excluding VAT
 *   10  output VAT 25 %     11  output VAT 12 %     12  output VAT 6 %
 *   48  input VAT to deduct
 *   49  VAT to pay or get back = 10 + 11 + 12 + 30 + 31 + 32 + 60 + 61 + 62 - 48
 *
 * File format (eSKDUpload version 6.0), read 2026-11-15:
 * https://www.skatteverket.se/foretag/moms/deklareramoms/skapaochskickainmomsdeklarationviafil.4.2fb39afe18dabf1e4d223cc.html
 *
 * How the figures are derived. Output VAT is posted to account 2610 whatever
 * the rate, so the split over boxes 10, 11 and 12 comes from each
 * Transaction's direction, vatRate, netAmount and vatAmount. A correcting
 * entry has the same direction and negative amounts, so summing every entry
 * in the period nets a cancelled pair to zero. Nothing is filtered on sign.
 *
 * What the data model cannot fill: boxes 06 to 08, 20 to 24, 30 to 32, 35 to
 * 42, 50 and 60 to 62 (self-supply, margin scheme, EU trade, reverse charge,
 * export, exempt sales, import). They are reported as not supported and left
 * out of the file; they are never presented as zero.
 *
 * Whole kronor: the form takes no öre. Each box drops its öre (truncation
 * towards zero) and box 49 is computed from the whole-krona boxes so the
 * return adds up the way Skatteverket's form checks it.
 */

import { type Prisma } from "@prisma/client";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { asNumber } from "@/lib/accounting/math";
import { lockPeriod } from "@/lib/accounting/period-locks";
import { prisma } from "@/lib/db";
import { TransactionDirections } from "@/lib/domain/enums";

export const MOMS_FILING_TYPE = "MOMS";
/** Older rows written by the Skatteverket API route use this type. */
export const MOMS_FILING_TYPES = [MOMS_FILING_TYPE, "MOMSDEKLARATION"];
export const MOMS_FILED_STATUSES = ["SUBMITTED", "ACCEPTED"];

export type MomsRate = 25 | 12 | 6;
export type MomsBoxId = "05" | "10" | "11" | "12" | "48" | "49";

export const UNSUPPORTED_BOX_GROUPS = [
  { id: "selfSupply", boxes: ["06", "07", "08"] },
  { id: "reverseCharge", boxes: ["20", "21", "22", "23", "24", "30", "31", "32"] },
  { id: "exemptSales", boxes: ["35", "36", "37", "38", "39", "40", "41", "42"] },
  { id: "import", boxes: ["50", "60", "61", "62"] }
] as const;

export type MomsEntry = {
  id: string;
  verificationNumber: number;
  txnDate: Date;
  description: string;
  /** Amount excluding VAT, signed (negative on a correcting entry). */
  net: number;
  /** VAT amount, signed. */
  vat: number;
  rate: MomsRate | null;
  receiptId: string | null;
  /** True for a cancelled entry. Its correcting entry nets it out. */
  cancelled: boolean;
  /** True for the correcting entry of a cancelled one. */
  correction: boolean;
};

export type MomsBoxes = Record<MomsBoxId, number>;

export type MomsBlocker = {
  id: "receiptsPending" | "unclearRate" | "salesAccountWithoutVat" | "ledgerMismatch";
  /** blocker: the return is wrong until fixed. warning: check before filing. */
  severity: "blocker" | "warning";
  count: number;
  /** Amount involved, where one figure describes the problem. */
  amount?: number;
  items: Array<{ id: string; label: string; date: Date | null; amount: number | null; href: string }>;
};

export type Momsdeklaration = {
  from: Date;
  to: Date;
  /** Whole kronor, as they go on the form. */
  boxes: MomsBoxes;
  /** The same figures before the öre are dropped. */
  exact: MomsBoxes;
  /** The entries behind each box. Box 49 is a sum and has none. */
  entries: Record<Exclude<MomsBoxId, "49">, MomsEntry[]>;
  /** Sales entries with VAT whose rate is not 25, 12 or 6 %. They are in no box. */
  unclassified: MomsEntry[];
  /** Sales booked without VAT. They are in no box; some may belong in boxes 35 to 42. */
  salesWithoutVat: { amount: number; count: number };
  crossCheck: {
    boxOutputVat: number;
    boxInputVat: number;
    ledgerOutputVat: number;
    ledgerInputVat: number;
    outputDifference: number;
    inputDifference: number;
    ok: boolean;
  };
  blockers: MomsBlocker[];
  entryCount: number;
};

type TransactionRow = {
  id: string;
  verificationNumber: number;
  txnDate: Date;
  description: string;
  direction: string;
  netAmount: unknown;
  vatAmount: unknown;
  vatRate: unknown;
  receiptId: string | null;
  voidedAt: Date | null;
  reversesTransactionId: string | null;
  lines: Array<{ debit: unknown; credit: unknown; account: { code: string; type: string; vatCode: string | null } }>;
};

const STANDARD_RATES: MomsRate[] = [25, 12, 6];

/** Money as integer öre, so sums cannot drift. */
const toOre = (value: unknown): number => Math.round(asNumber(value) * 100);
const fromOre = (ore: number): number => ore / 100;

/** Drop the öre. -0 is normalised to 0. */
export const toWholeKronor = (amount: number): number => Math.trunc(Math.round(amount * 100) / 100) + 0;

/**
 * Which of the three Swedish VAT rates an entry carries.
 *
 * The amounts decide: VAT divided by the net amount, with room for öre
 * rounding. That also covers a missing stored rate and one computed from
 * rounded amounts (0.2501). A stored rate that the amounts contradict is not
 * trusted. Null means the rate cannot be told, for example a receipt that
 * mixes 25 % and 12 % goods in one entry. Only when there is no net amount to
 * compare with does the stored rate decide.
 */
export const classifyVatRate = (storedRate: number, net: number, vat: number): MomsRate | null => {
  if (net !== 0) {
    const tolerance = Math.max(0.02, Math.abs(net) * 0.005);
    for (const standard of STANDARD_RATES) {
      if (Math.abs(vat - net * (standard / 100)) <= tolerance) return standard;
    }
    return null;
  }
  const rate = storedRate > 1 ? storedRate / 100 : storedRate;
  for (const standard of STANDARD_RATES) {
    if (Math.abs(rate - standard / 100) <= 0.0005) return standard;
  }
  return null;
};

const toEntry = (row: TransactionRow, rate: MomsRate | null): MomsEntry => ({
  id: row.id,
  verificationNumber: row.verificationNumber,
  txnDate: row.txnDate,
  description: row.description,
  net: asNumber(row.netAmount),
  vat: asNumber(row.vatAmount),
  rate,
  receiptId: row.receiptId,
  cancelled: row.voidedAt !== null,
  correction: row.reversesTransactionId !== null
});

const entryHref = (entry: Pick<MomsEntry, "id" | "receiptId">) =>
  entry.receiptId ? `/review/receipts/${entry.receiptId}` : `/review/transactions/${entry.id}`;

const isOutputVatAccount = (code: string) => /^26[123]\d$/.test(code);
const isInputVatAccount = (code: string) => /^264\d$/.test(code);
/** 2650 is the VAT settlement account: an entry that touches it moves VAT, it does not create any. */
const isVatSettlementAccount = (code: string) => code === "2650";

/** Pure: the boxes, the entries behind them and the ledger comparison. */
export const computeMomsdeklaration = (rows: TransactionRow[]) => {
  const ore = { b05: 0, b10: 0, b11: 0, b12: 0, b48: 0, unclassifiedVat: 0, salesWithoutVat: 0 };
  let ledgerOutputOre = 0;
  let ledgerInputOre = 0;
  let salesWithoutVatCount = 0;

  const entries: Momsdeklaration["entries"] = { "05": [], "10": [], "11": [], "12": [], "48": [] };
  const unclassified: MomsEntry[] = [];
  const salesAccountWithoutVat: MomsEntry[] = [];
  const vatOutsideSalesAndPurchases: MomsEntry[] = [];

  for (const row of rows) {
    const netOre = toOre(row.netAmount);
    const vatOre = toOre(row.vatAmount);
    // Not "> 0": a correcting entry carries negative amounts and must net out.
    const hasVat = vatOre !== 0;

    const settlement = row.lines.some((line) => isVatSettlementAccount(line.account.code));
    let rowLedgerVatOre = 0;
    if (!settlement) {
      for (const line of row.lines) {
        const debit = toOre(line.debit);
        const credit = toOre(line.credit);
        if (isOutputVatAccount(line.account.code)) {
          ledgerOutputOre += credit - debit;
          rowLedgerVatOre += credit - debit;
        } else if (isInputVatAccount(line.account.code)) {
          ledgerInputOre += debit - credit;
          rowLedgerVatOre += debit - credit;
        }
      }
    }

    if (row.direction === TransactionDirections.INCOME && hasVat) {
      const rate = classifyVatRate(asNumber(row.vatRate), fromOre(netOre), fromOre(vatOre));
      const entry = toEntry(row, rate);
      if (rate === null) {
        ore.unclassifiedVat += vatOre;
        unclassified.push(entry);
        continue;
      }
      ore.b05 += netOre;
      entries["05"].push(entry);
      if (rate === 25) ore.b10 += vatOre;
      else if (rate === 12) ore.b11 += vatOre;
      else ore.b12 += vatOre;
      entries[rate === 25 ? "10" : rate === 12 ? "11" : "12"].push(entry);
    } else if (row.direction === TransactionDirections.EXPENSE && hasVat) {
      ore.b48 += vatOre;
      entries["48"].push(toEntry(row, classifyVatRate(asNumber(row.vatRate), fromOre(netOre), fromOre(vatOre))));
    } else if (row.direction === TransactionDirections.INCOME) {
      // A sale without VAT. Only revenue accounts count: an accrual settlement
      // (bank against receivables) is also an INCOME entry without VAT.
      let revenueOre = 0;
      let onVatCodedAccount = false;
      for (const line of row.lines) {
        if (line.account.type !== "INCOME" || !line.account.code.startsWith("3")) continue;
        revenueOre += toOre(line.credit) - toOre(line.debit);
        if (line.account.vatCode?.startsWith("OUT_")) onVatCodedAccount = true;
      }
      if (revenueOre !== 0) {
        ore.salesWithoutVat += revenueOre;
        salesWithoutVatCount += 1;
        if (onVatCodedAccount) salesAccountWithoutVat.push(toEntry(row, null));
      }
      if (rowLedgerVatOre !== 0) vatOutsideSalesAndPurchases.push(toEntry(row, null));
    } else if (rowLedgerVatOre !== 0) {
      // VAT on the ledger from an entry that is neither a sale nor a purchase
      // with a VAT amount (a transfer, or an imported journal).
      vatOutsideSalesAndPurchases.push(toEntry(row, null));
    }
  }

  const exact: MomsBoxes = {
    "05": fromOre(ore.b05),
    "10": fromOre(ore.b10),
    "11": fromOre(ore.b11),
    "12": fromOre(ore.b12),
    "48": fromOre(ore.b48),
    "49": fromOre(ore.b10 + ore.b11 + ore.b12 - ore.b48)
  };

  const whole = {
    "05": toWholeKronor(exact["05"]),
    "10": toWholeKronor(exact["10"]),
    "11": toWholeKronor(exact["11"]),
    "12": toWholeKronor(exact["12"]),
    "48": toWholeKronor(exact["48"])
  };
  const boxes: MomsBoxes = { ...whole, "49": whole["10"] + whole["11"] + whole["12"] - whole["48"] };

  const boxOutputOre = ore.b10 + ore.b11 + ore.b12;
  const outputDifferenceOre = boxOutputOre - ledgerOutputOre;
  const inputDifferenceOre = ore.b48 - ledgerInputOre;

  return {
    boxes,
    exact,
    entries,
    unclassified,
    unclassifiedVat: fromOre(ore.unclassifiedVat),
    salesAccountWithoutVat,
    vatOutsideSalesAndPurchases,
    salesWithoutVat: { amount: fromOre(ore.salesWithoutVat), count: salesWithoutVatCount },
    crossCheck: {
      boxOutputVat: fromOre(boxOutputOre),
      boxInputVat: fromOre(ore.b48),
      ledgerOutputVat: fromOre(ledgerOutputOre),
      ledgerInputVat: fromOre(ledgerInputOre),
      outputDifference: fromOre(outputDifferenceOre),
      inputDifference: fromOre(inputDifferenceOre),
      ok: outputDifferenceOre === 0 && inputDifferenceOre === 0
    }
  };
};

const MAX_BLOCKER_ITEMS = 25;

const entryItems = (list: MomsEntry[], amountOf: (entry: MomsEntry) => number) =>
  list.slice(0, MAX_BLOCKER_ITEMS).map((entry) => ({
    id: entry.id,
    label: `${entry.verificationNumber}: ${entry.description}`,
    date: entry.txnDate,
    amount: amountOf(entry),
    href: entryHref(entry)
  }));

/**
 * The return for one business and period: boxes, the entries behind them,
 * the comparison with the ledger's VAT accounts and what stands in the way of
 * a correct return.
 */
export const buildMomsdeklaration = async (params: {
  businessId: string;
  from: Date;
  to: Date;
}): Promise<Momsdeklaration> => {
  const { businessId, from, to } = params;

  const [rows, pendingReceipts] = await Promise.all([
    prisma.transaction.findMany({
      where: { businessId, txnDate: { gte: from, lte: to } },
      select: {
        id: true,
        verificationNumber: true,
        txnDate: true,
        description: true,
        direction: true,
        netAmount: true,
        vatAmount: true,
        vatRate: true,
        receiptId: true,
        voidedAt: true,
        reversesTransactionId: true,
        lines: {
          select: { debit: true, credit: true, account: { select: { code: true, type: true, vatCode: true } } }
        }
      },
      orderBy: [{ txnDate: "asc" }, { verificationNumber: "asc" }]
    }),
    // A receipt is only booked once it has been reviewed, so one that is still
    // waiting is missing from the return. Undated receipts count by upload date.
    prisma.receipt.findMany({
      where: {
        businessId,
        deletedAt: null,
        needsReview: true,
        OR: [
          { receiptDate: { gte: from, lte: to } },
          { receiptDate: null, createdAt: { gte: from, lte: to } }
        ]
      },
      select: { id: true, vendor: true, originalFileName: true, receiptDate: true, createdAt: true, grossAmount: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const computed = computeMomsdeklaration(rows);
  const blockers: MomsBlocker[] = [];

  if (pendingReceipts.length > 0) {
    blockers.push({
      id: "receiptsPending",
      severity: "blocker",
      count: pendingReceipts.length,
      items: pendingReceipts.slice(0, MAX_BLOCKER_ITEMS).map((receipt) => ({
        id: receipt.id,
        label: receipt.vendor?.trim() || receipt.originalFileName,
        date: receipt.receiptDate ?? receipt.createdAt,
        amount: receipt.grossAmount === null ? null : asNumber(receipt.grossAmount),
        href: `/review/receipts/${receipt.id}`
      }))
    });
  }

  if (computed.unclassified.length > 0) {
    blockers.push({
      id: "unclearRate",
      severity: "blocker",
      count: computed.unclassified.length,
      amount: computed.unclassifiedVat,
      items: entryItems(computed.unclassified, (entry) => entry.vat)
    });
  }

  if (!computed.crossCheck.ok) {
    blockers.push({
      id: "ledgerMismatch",
      severity: "blocker",
      count: computed.vatOutsideSalesAndPurchases.length,
      items: entryItems(computed.vatOutsideSalesAndPurchases, (entry) => entry.vat)
    });
  }

  if (computed.salesAccountWithoutVat.length > 0) {
    blockers.push({
      id: "salesAccountWithoutVat",
      severity: "warning",
      count: computed.salesAccountWithoutVat.length,
      items: entryItems(computed.salesAccountWithoutVat, (entry) => entry.net)
    });
  }

  return {
    from,
    to,
    boxes: computed.boxes,
    exact: computed.exact,
    entries: computed.entries,
    unclassified: computed.unclassified,
    salesWithoutVat: computed.salesWithoutVat,
    crossCheck: computed.crossCheck,
    blockers,
    entryCount: rows.length
  };
};

/**
 * The first day the business can have had anything to report: the earlier of
 * its fiscal year start and its earliest booked entry (so imported history
 * still produces periods). Periods that ended before this day are not listed.
 */
export const vatActiveFrom = async (business: { id: string; fiscalYearStart: Date | string }): Promise<Date> => {
  const fiscalYearStart =
    business.fiscalYearStart instanceof Date ? business.fiscalYearStart : new Date(business.fiscalYearStart);
  const earliest = await prisma.transaction.aggregate({
    where: { businessId: business.id },
    _min: { txnDate: true }
  });
  const firstEntry = earliest._min.txnDate;
  return firstEntry && firstEntry < fiscalYearStart ? firstEntry : fiscalYearStart;
};

// ─── The file ────────────────────────────────────────────────────────────────

/**
 * The identity number as Skatteverket's file wants it: ten digits,
 * "xxxxxx-xxxx". Accepts a personnummer with or without century, an
 * organisation number or a Swedish VAT number (SE + ten digits + 01).
 */
export const normalizeOrgNr = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const compact = raw.replace(/[\s+-]/g, "").toUpperCase();
  const vat = /^SE(\d{10})01$/.exec(compact);
  if (!vat && !/^\d+$/.test(compact)) return null;
  let digits = vat ? vat[1] : compact;
  if (digits.length === 12) digits = digits.slice(2);
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
};

/** A sole trader files under the personnummer; fall back to the other identifiers on file. */
export const resolveOrgNr = (business: {
  personnummer?: string | null;
  vatNumber?: string | null;
  invoiceSenderOrgNumber?: string | null;
}): string | null =>
  normalizeOrgNr(business.personnummer) ??
  normalizeOrgNr(business.vatNumber) ??
  normalizeOrgNr(business.invoiceSenderOrgNumber);

/** Element names in the order Skatteverket's table gives them (rows 6 to 34). */
const ESKD_ELEMENTS: Array<{ box: MomsBoxId; element: string }> = [
  { box: "05", element: "ForsMomsEjAnnan" },
  { box: "10", element: "MomsUtgHog" },
  { box: "11", element: "MomsUtgMedel" },
  { box: "12", element: "MomsUtgLag" },
  { box: "48", element: "MomsIngAvdr" },
  { box: "49", element: "MomsBetala" }
];

export const ESKD_ENCODING = "ISO-8859-1";

/**
 * The eSKDUpload file for the e-service "Lämna momsdeklaration" (Deklarera via fil).
 *
 * Per Skatteverket's description: XML declaration with ISO-8859-1, root
 * eSKDUpload Version="6.0", OrgNr, Moms, Period (year and last month of the
 * period), then the boxes in table order. A box with nothing to report is
 * left out; MomsBetala (box 49) is mandatory, also when it is 0. Amounts are
 * whole numbers, a minus sign directly before the digits for a negative
 * amount (a refund in box 49). No DOCTYPE: the page lists none and the DTD
 * address older guides point to no longer answers.
 */
export const buildEskdXml = (params: { orgNr: string; skvPeriod: string; boxes: MomsBoxes }): string => {
  if (!/^\d{6}-\d{4}$/.test(params.orgNr)) throw new Error("OrgNr must be ten digits in the form xxxxxx-xxxx.");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(params.skvPeriod)) throw new Error("Period must be YYYYMM.");

  const lines = [
    `<?xml version="1.0" encoding="${ESKD_ENCODING}"?>`,
    `<eSKDUpload Version="6.0">`,
    `<OrgNr>${params.orgNr}</OrgNr>`,
    `<Moms>`,
    `<Period>${params.skvPeriod}</Period>`
  ];

  for (const { box, element } of ESKD_ELEMENTS) {
    const amount = params.boxes[box];
    if (!Number.isInteger(amount)) throw new Error(`Box ${box} must be in whole kronor.`);
    if (amount === 0 && box !== "49") continue;
    lines.push(`<${element}>${amount}</${element}>`);
  }

  lines.push(`</Moms>`, `</eSKDUpload>`);
  return lines.join("\n");
};

/** The file's bytes. The content is plain ASCII, which is valid ISO-8859-1. */
export const encodeEskdXml = (xml: string): Buffer => Buffer.from(xml, "latin1");

// ─── Recording a filed return ────────────────────────────────────────────────

export class MomsFilingError extends Error {
  constructor(
    message: string,
    public readonly status: number = 409
  ) {
    super(message);
    this.name = "MomsFilingError";
  }
}

export const findMomsFilings = (businessId: string, range?: { from: Date; to: Date }) =>
  prisma.filing.findMany({
    where: {
      businessId,
      filingType: { in: MOMS_FILING_TYPES },
      status: { in: MOMS_FILED_STATUSES },
      ...(range ? { periodStart: { gte: range.from }, periodEnd: { lte: range.to } } : {})
    },
    orderBy: { submittedAt: "desc" }
  });

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** From a list of filings, the one for exactly this period. */
export const matchMomsFiling = <T extends { periodStart: Date; periodEnd: Date }>(
  filings: T[],
  period: { start: Date; end: Date }
): T | null => filings.find((f) => sameDay(f.periodStart, period.start) && sameDay(f.periodEnd, period.end)) ?? null;

/** The filed return for exactly this period, if there is one. */
export const findMomsFiling = async (businessId: string, period: { start: Date; end: Date }) =>
  matchMomsFiling(await findMomsFilings(businessId), period);

/**
 * "I have filed this": store the Filing with the figures that were filed,
 * write an audit row and, unless the user opted out, lock the period so
 * nothing more can be booked into it.
 *
 * The Filing and its audit row are written in one database transaction. The
 * lock follows; if it fails the filing stands and `lockError` says why.
 */
export const recordMomsFiling = async (params: {
  businessId: string;
  userId?: string | null;
  period: { start: Date; end: Date; skvPeriod: string; deadline: Date; frequency: string };
  lock: boolean;
}) => {
  const { businessId, userId, period } = params;

  if (await findMomsFiling(businessId, period)) {
    throw new MomsFilingError("This period is already recorded as filed.");
  }

  const declaration = await buildMomsdeklaration({ businessId, from: period.start, to: period.end });
  const submittedAt = new Date();
  const payload = {
    method: "MANUAL_FILE_UPLOAD",
    format: "eSKDUpload 6.0",
    skvPeriod: period.skvPeriod,
    frequency: period.frequency,
    deadline: period.deadline.toISOString().slice(0, 10),
    boxes: declaration.boxes,
    exact: declaration.exact,
    crossCheck: declaration.crossCheck,
    openBlockers: declaration.blockers.map((b) => ({ id: b.id, severity: b.severity, count: b.count })),
    entryCount: declaration.entryCount
  };

  const filing = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.filing.create({
      data: {
        businessId,
        filingType: MOMS_FILING_TYPE,
        periodStart: period.start,
        periodEnd: period.end,
        status: "SUBMITTED",
        payloadJson: JSON.stringify(payload),
        submittedAt
      }
    });
    await writeLedgerAudit(tx, {
      businessId,
      userId,
      entityType: "Filing",
      entityId: created.id,
      action: "VAT_RETURN_FILED",
      after: { periodStart: period.start, periodEnd: period.end, boxes: declaration.boxes, lock: params.lock }
    });
    return created;
  });

  let locked = false;
  let lockError: string | null = null;
  if (params.lock) {
    try {
      const covering = await prisma.periodLock.findFirst({
        where: { businessId, periodStart: { lte: period.start }, periodEnd: { gte: period.end } },
        select: { id: true }
      });
      if (!covering) {
        const lock = await lockPeriod(businessId, period.start, period.end, userId ?? undefined);
        await writeLedgerAudit(prisma, {
          businessId,
          userId,
          entityType: "PeriodLock",
          entityId: lock.id,
          action: "LOCK",
          after: { periodStart: period.start, periodEnd: period.end, reason: "VAT return filed", filingId: filing.id }
        });
      }
      locked = true;
    } catch (error) {
      lockError = error instanceof Error ? error.message : "The period could not be locked.";
    }
  }

  return { filing, declaration, locked, lockError };
};

/** The boxes stored on a filed return, or null if the row has none (older rows). */
export const filedBoxes = (payloadJson: string | null): MomsBoxes | null => {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as { boxes?: Partial<MomsBoxes> };
    const boxes = parsed.boxes;
    if (!boxes) return null;
    const ids: MomsBoxId[] = ["05", "10", "11", "12", "48", "49"];
    if (!ids.every((id) => typeof boxes[id] === "number")) return null;
    return boxes as MomsBoxes;
  } catch {
    return null;
  }
};
