/**
 * Everything the guided year-end needs for one fiscal year (a calendar year):
 * what is still open, the NE-bilaga, the tax estimate and whether the SRU files
 * can be produced.
 *
 * The user's own answers (figures only they know, the bank statement balance,
 * details for the SRU files) are kept as a draft Filing of type "NE" for the
 * year. Nothing here writes to the ledger.
 */

import { z } from "zod";

import { asNumber, round2 } from "@/lib/accounting/math";
import { buildBalanceSheet } from "@/lib/accounting/reports";
import { prisma } from "@/lib/db";
import { invoiceOpenAmounts, invoiceOpenSelect } from "@/lib/invoices/balance";
import { resolveAndEstimate } from "@/lib/tax/engines";
import { buildNeBilaga, NE_MANUAL_BOX_IDS, neAmount, type NeBilaga, type NeManualInputs } from "@/lib/tax/neBilaga";
import {
  birthYearFromPersonnummer,
  NE_SRU_EDITIONS,
  sruMissingDetails,
  sruSupportedIncomeYears,
  type SruGeneral,
  type SruMissing,
  type SruSubmitter
} from "@/lib/tax/sru";

export const NE_FILING_TYPE = "NE";

// ─── The user's own answers ───────────────────────────────────────────────────

const amount = z.number().finite().min(0).max(999_999_999_999);

export const yearEndInputsSchema = z.object({
  manual: z.partialRecord(z.enum(NE_MANUAL_BOX_IDS), amount.nullable()).optional(),
  /** Closing balance on the bank statement at 31 December, as typed by the user. */
  bankStatementBalance: z.number().finite().nullable().optional(),
  /** Steps the user has confirmed by hand because the app has no data for them. */
  confirmed: z.object({ supplierBills: z.boolean().optional(), customerInvoices: z.boolean().optional() }).optional(),
  submitter: z
    .object({
      name: z.string().max(250).optional(),
      personnummer: z.string().max(20).optional(),
      address: z.string().max(250).optional(),
      postalCode: z.string().max(10).optional(),
      city: z.string().max(250).optional(),
      email: z.string().max(250).optional()
    })
    .optional(),
  general: z
    .object({
      activity: z.string().max(80).optional(),
      helped: z.enum(["yes", "no"]).nullable().optional()
    })
    .optional()
});

export type YearEndInputsPatch = z.infer<typeof yearEndInputsSchema>;

export type YearEndInputs = {
  manual: NeManualInputs;
  bankStatementBalance: number | null;
  confirmed: { supplierBills: boolean; customerInvoices: boolean };
  submitter: Partial<SruSubmitter>;
  general: SruGeneral;
};

const emptyInputs = (): YearEndInputs => ({
  manual: {},
  bankStatementBalance: null,
  confirmed: { supplierBills: false, customerInvoices: false },
  submitter: {},
  general: {}
});

const yearBounds = (year: number) => ({
  yearStart: new Date(Date.UTC(year, 0, 1)),
  yearEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
});

const findNeFiling = (businessId: string, year: number) => {
  const { yearStart, yearEnd } = yearBounds(year);
  return prisma.filing.findFirst({
    where: { businessId, filingType: NE_FILING_TYPE, periodStart: yearStart, periodEnd: yearEnd },
    orderBy: { createdAt: "asc" }
  });
};

const parseStored = (payloadJson: string | null | undefined): YearEndInputs => {
  const inputs = emptyInputs();
  if (!payloadJson) return inputs;
  try {
    const parsed = yearEndInputsSchema.safeParse(JSON.parse(payloadJson));
    if (!parsed.success) return inputs;
    return mergeInputs(inputs, parsed.data);
  } catch {
    return inputs;
  }
};

const mergeInputs = (current: YearEndInputs, patch: YearEndInputsPatch): YearEndInputs => {
  const next: YearEndInputs = {
    manual: { ...current.manual },
    bankStatementBalance: current.bankStatementBalance,
    confirmed: { ...current.confirmed },
    submitter: { ...current.submitter },
    general: { ...current.general }
  };
  for (const [id, value] of Object.entries(patch.manual ?? {})) {
    const key = id as keyof NeManualInputs;
    if (value === null || value === undefined) delete next.manual[key];
    else next.manual[key] = Math.round(value);
  }
  if (patch.bankStatementBalance !== undefined) next.bankStatementBalance = patch.bankStatementBalance;
  if (patch.confirmed?.supplierBills !== undefined) next.confirmed.supplierBills = patch.confirmed.supplierBills;
  if (patch.confirmed?.customerInvoices !== undefined) next.confirmed.customerInvoices = patch.confirmed.customerInvoices;
  for (const [key, value] of Object.entries(patch.submitter ?? {})) {
    if (value !== undefined) next.submitter[key as keyof SruSubmitter] = value.trim();
  }
  if (patch.general?.activity !== undefined) next.general.activity = patch.general.activity.trim();
  if (patch.general?.helped !== undefined) next.general.helped = patch.general.helped;
  return next;
};

export const getYearEndInputs = async (businessId: string, year: number): Promise<YearEndInputs> => {
  const filing = await findNeFiling(businessId, year);
  return parseStored(filing?.payloadJson);
};

export const saveYearEndInputs = async (
  businessId: string,
  year: number,
  patch: YearEndInputsPatch
): Promise<YearEndInputs> => {
  const { yearStart, yearEnd } = yearBounds(year);
  const filing = await findNeFiling(businessId, year);
  const next = mergeInputs(parseStored(filing?.payloadJson), patch);
  const payloadJson = JSON.stringify(next);
  if (filing) {
    await prisma.filing.update({ where: { id: filing.id }, data: { payloadJson } });
  } else {
    await prisma.filing.create({
      data: { businessId, filingType: NE_FILING_TYPE, periodStart: yearStart, periodEnd: yearEnd, status: "DRAFT", payloadJson }
    });
  }
  return next;
};

// ─── Overview ─────────────────────────────────────────────────────────────────

export type StepStatus = "done" | "attention" | "na";

export type TaxEstimateSummary = {
  /** Surplus the estimate is based on (R42: before this year's deduction for egenavgifter). */
  basis: number;
  socialContributions: number;
  incomeTax: number;
  total: number;
  engine: string;
};

export type YearEndOverview = {
  year: number;
  /** The year has ended (31 December has passed). */
  yearEnded: boolean;
  /** A period lock covers the whole year. */
  closed: boolean;
  closedAt: string | null;
  /** Locks that cover only part of the year (for example after a VAT return). They do not block the close. */
  partialLocks: Array<{ id: string; from: string; to: string }>;
  bookkeepingMethod: string;
  inputs: YearEndInputs;
  receipts: { waiting: number; status: StepStatus };
  customerInvoices: {
    /** Invoices with something still to come in on 31 December, from the customer or from Skatteverket. */
    unpaidCount: number;
    unpaidTotal: number;
    /** Of those: ROT/RUT reductions Skatteverket had not yet paid out. Included in unpaidTotal. */
    skatteverketCount: number;
    skatteverketTotal: number;
    /** Balance on 15xx at year end. */
    bookedReceivables: number;
    status: StepStatus;
  };
  supplierBills: { bookedPayables: number; status: StepStatus };
  balance: { totalAssets: number; liabilitiesAndEquity: number; difference: number; status: StepStatus };
  bank: { ledgerBalance: number; statementBalance: number | null; difference: number | null; status: StepStatus };
  assets: { count: number; registerDepreciation: number; bookedDepreciation: number; unbookedDepreciation: number; disposalsThisYear: number; status: StepStatus };
  reserves: {
    allocation: number;
    allocationMax: number;
    withdrawal: number;
    /** Allocations from six years back or more that have not been reversed. They must be reversed this year. */
    overdue: number;
    expansionsfond: number;
    status: StepStatus;
  };
  mileage: { deduction: number; unbooked: number; status: StepStatus };
  ne: NeBilaga;
  taxEstimate: TaxEstimateSummary | null;
  sru: {
    supported: boolean;
    supportedYears: number[];
    block: string | null;
    missing: SruMissing[];
    ready: boolean;
    /** Defaults for the details form, from the business settings. */
    defaults: Partial<SruSubmitter>;
  };
  stepsDone: number;
  stepsOpen: number;
};

const sameAmount = (a: number, b: number) => Math.abs(round2(a - b)) < 1;

export const buildYearEndOverview = async (businessId: string, year: number, now = new Date()): Promise<YearEndOverview> => {
  const { yearStart, yearEnd } = yearBounds(year);

  const [business, inputs, locks, receiptsWaiting, invoices, countryProfile, periodAll] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { taxConfig: true } }),
    getYearEndInputs(businessId, year),
    prisma.periodLock.findMany({
      where: { businessId, periodStart: { lte: yearEnd }, periodEnd: { gte: yearStart } },
      orderBy: { periodStart: "asc" }
    }),
    prisma.receipt.count({
      where: {
        businessId,
        deletedAt: null,
        needsReview: true,
        OR: [
          { receiptDate: { gte: yearStart, lte: yearEnd } },
          { receiptDate: null, createdAt: { gte: yearStart, lte: yearEnd } }
        ]
      }
    }),
    prisma.invoice.findMany({
      where: {
        businessId,
        issueDate: { lte: yearEnd },
        OR: [
          { status: { not: "PAID" } },
          { paidAt: { gt: yearEnd } },
          // ROT/RUT: paid by the customer, but Skatteverket's part had not come in by year end.
          { rotRutType: { not: null }, OR: [{ rotRutPaidOutAt: null }, { rotRutPaidOutAt: { gt: yearEnd } }] }
        ]
      },
      select: invoiceOpenSelect(yearEnd)
    }),
    prisma.countryTaxProfile.findUnique({
      where: { businessId },
      include: { incomeTaxBands: { orderBy: { bandOrder: "asc" } } }
    }),
    prisma.periodisationEntry.findMany({ where: { businessId, taxYear: { lte: year } } })
  ]);

  const submitter: Partial<SruSubmitter> = {
    name: inputs.submitter.name || business.invoiceSenderName || "",
    personnummer: inputs.submitter.personnummer || business.personnummer || "",
    address: inputs.submitter.address ?? "",
    postalCode: inputs.submitter.postalCode ?? "",
    city: inputs.submitter.city ?? "",
    email: inputs.submitter.email || business.invoiceSenderEmail || ""
  };

  const [ne, sheet] = await Promise.all([
    buildNeBilaga(businessId, year, {
      manual: inputs.manual,
      birthYear: birthYearFromPersonnummer(submitter.personnummer),
      vatRegistered: business.vatRegistered
    }),
    buildBalanceSheet({ businessId, from: yearStart, to: yearEnd })
  ]);

  // ── Lock state ─────────────────────────────────────────────────────────────
  const fullLock = locks.find((lock) => lock.periodStart <= yearStart && lock.periodEnd >= yearEnd) ?? null;
  const partialLocks = fullLock
    ? []
    : locks.map((lock) => ({
        id: lock.id,
        from: lock.periodStart.toISOString().slice(0, 10),
        to: lock.periodEnd.toISOString().slice(0, 10)
      }));

  // ── Invoices unpaid at year end ────────────────────────────────────────────
  // What the customer still owed, plus for ROT/RUT the reduction Skatteverket had not yet paid out:
  // both are income not yet received on 31 December.
  const openInvoices = invoices
    .map((invoice) => invoiceOpenAmounts(invoice, yearEnd))
    .filter((open) => open.customer > 0 || open.skatteverket > 0);
  const unpaid = openInvoices.map((open) => round2(open.customer + open.skatteverket));
  const skatteverketClaims = openInvoices.filter((open) => open.skatteverket > 0);
  const skatteverketTotal = round2(skatteverketClaims.reduce((sum, open) => sum + open.skatteverket, 0));
  const unpaidTotal = round2(unpaid.reduce((sum, value) => sum + value, 0));
  const bookedReceivables = neAmount(ne, "B7");
  const bookedPayables = neAmount(ne, "B15");

  const invoiceStatus: StepStatus =
    unpaid.length === 0
      ? "done"
      : sameAmount(unpaidTotal, bookedReceivables) || inputs.confirmed.customerInvoices
        ? "done"
        : "attention";

  // ── Bank ───────────────────────────────────────────────────────────────────
  const ledgerBank = ne.facts.bankBalance;
  const statement = inputs.bankStatementBalance;
  const bankDifference = statement === null ? null : round2(statement - ledgerBank);

  // ── Reserves ───────────────────────────────────────────────────────────────
  const pf = periodAll.filter((entry) => entry.entryType === "periodiseringsfond");
  const allocatedLongAgo = pf
    .filter((entry) => entry.direction === "allocation" && entry.taxYear <= year - 6)
    .reduce((sum, entry) => sum + asNumber(entry.amount), 0);
  const withdrawnSoFar = pf
    .filter((entry) => entry.direction === "withdrawal")
    .reduce((sum, entry) => sum + asNumber(entry.amount), 0);
  const overdue = Math.max(0, round2(allocatedLongAgo - withdrawnSoFar));
  const hasReserves =
    ne.facts.pfAllocationRequested > 0 || ne.facts.pfWithdrawal > 0 || ne.facts.efAllocationRequested > 0 || ne.facts.efWithdrawal > 0;
  const reservesStatus: StepStatus =
    overdue > 0 || ne.facts.pfAllocationRequested > ne.facts.pfAllocationMax ? "attention" : hasReserves ? "done" : "na";

  // ── Tax estimate ───────────────────────────────────────────────────────────
  let taxEstimate: TaxEstimateSummary | null = null;
  try {
    const basis = Math.max(0, neAmount(ne, "R42"));
    const estimate = resolveAndEstimate(basis, business, countryProfile);
    taxEstimate = {
      basis,
      socialContributions: estimate.estimatedSocialContributions,
      incomeTax: estimate.estimatedIncomeTax,
      total: estimate.totalEstimatedTax,
      engine: estimate.engine
    };
  } catch {
    taxEstimate = null;
  }

  // ── SRU ────────────────────────────────────────────────────────────────────
  const missing = sruMissingDetails(year, submitter);

  const overview: YearEndOverview = {
    year,
    yearEnded: now > yearEnd,
    closed: fullLock !== null,
    closedAt: fullLock ? fullLock.lockedAt.toISOString() : null,
    partialLocks,
    bookkeepingMethod: business.bookkeepingMethod,
    inputs,
    receipts: { waiting: receiptsWaiting, status: receiptsWaiting === 0 ? "done" : "attention" },
    customerInvoices: {
      unpaidCount: unpaid.length,
      unpaidTotal,
      skatteverketCount: skatteverketClaims.length,
      skatteverketTotal,
      bookedReceivables,
      status: invoiceStatus
    },
    supplierBills: {
      bookedPayables,
      status: inputs.confirmed.supplierBills || bookedPayables !== 0 ? "done" : "attention"
    },
    balance: {
      totalAssets: sheet.totalAssets,
      liabilitiesAndEquity: sheet.liabilitiesAndEquity,
      difference: sheet.difference,
      status: sheet.difference === 0 ? "done" : "attention"
    },
    bank: {
      ledgerBalance: ledgerBank,
      statementBalance: statement,
      difference: bankDifference,
      status: bankDifference !== null && Math.abs(bankDifference) < 0.005 ? "done" : "attention"
    },
    assets: {
      count: ne.facts.fixedAssetCount,
      registerDepreciation: ne.facts.registerDepreciation,
      bookedDepreciation: ne.facts.bookedDepreciation,
      unbookedDepreciation: ne.facts.unbookedDepreciation,
      disposalsThisYear: ne.facts.disposalsThisYear,
      status:
        ne.facts.fixedAssetCount === 0 && ne.facts.bookedDepreciation === 0
          ? "na"
          : ne.facts.disposalsThisYear > 0
            ? "attention"
            : "done"
    },
    reserves: {
      allocation: ne.facts.pfAllocation,
      allocationMax: ne.facts.pfAllocationMax,
      withdrawal: ne.facts.pfWithdrawal,
      overdue,
      expansionsfond: ne.facts.efAllocation - ne.facts.efWithdrawal,
      status: reservesStatus
    },
    mileage: {
      deduction: ne.facts.mileageDeduction,
      unbooked: ne.facts.unbookedMileage,
      status: ne.facts.mileageDeduction > 0 ? "done" : "na"
    },
    ne,
    taxEstimate,
    sru: {
      supported: NE_SRU_EDITIONS[year] !== undefined,
      supportedYears: sruSupportedIncomeYears(),
      block: NE_SRU_EDITIONS[year]?.block ?? null,
      missing,
      ready: missing.length === 0,
      defaults: submitter
    },
    stepsDone: 0,
    stepsOpen: 0
  };

  const statuses: StepStatus[] = [
    overview.receipts.status,
    overview.customerInvoices.status,
    overview.supplierBills.status,
    overview.balance.status,
    overview.bank.status,
    overview.assets.status,
    overview.reserves.status,
    overview.mileage.status,
    overview.closed ? "done" : "attention"
  ];
  overview.stepsDone = statuses.filter((status) => status === "done").length;
  overview.stepsOpen = statuses.filter((status) => status === "attention").length;
  return overview;
};

/** Years the guided year-end can be opened for: from the first booked entry to the current year. */
export const listYearEndYears = async (businessId: string, now = new Date()): Promise<number[]> => {
  const first = await prisma.transaction.findFirst({
    where: { businessId },
    orderBy: { txnDate: "asc" },
    select: { txnDate: true }
  });
  const currentYear = now.getUTCFullYear();
  const firstYear = Math.min(first ? first.txnDate.getUTCFullYear() : currentYear, currentYear);
  const years: number[] = [];
  for (let year = currentYear; year >= Math.max(firstYear, currentYear - 10); year -= 1) years.push(year);
  return years;
};
