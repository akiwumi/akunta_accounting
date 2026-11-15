/**
 * Guided journal entries: plain-language situations that each produce a
 * correct, balanced entry for a Swedish sole trader (enskild firma).
 *
 * Account choices follow the BAS chart for enskild firma:
 *
 *   Owner withdrawal             2013 Övriga egna uttag            / bank
 *   Owner deposit                bank / 2018 Övriga egna insättningar
 *   Private tax paid by the firm 2012 Avräkning för skatter och avgifter / bank
 *     (preliminary tax, egenavgifter and income tax are the owner's own taxes,
 *      never a cost in the business)
 *   Bank fee                     6570 Bankkostnader                / bank
 *   Interest received            bank / 8310 Ränteintäkter
 *   Interest paid                8410 Räntekostnader               / bank
 *   Loan received                bank / 2350 Skulder till kreditinstitut
 *   Loan repayment               2350 (amortering) + 8410 (ränta) + 6570 (avgift) / bank
 *   VAT paid or refunded         VAT accounts to 2650, then 2650 against bank,
 *                                whole-krona difference to 3740 Öres- och kronutjämning
 *   Depreciation                 7832 / 1229 (inventarier), 7834 / 1249 (bilar),
 *                                7840 / 1119 (byggnader), 7810 / 1019 (immateriella)
 *   Year end, kontantmetoden     unpaid customer invoices: 1510 / 30xx + 26x0
 *                                unpaid supplier bills:    cost + 2641 / 2440
 *                                each reversed on 1 January
 *   Transfer between own accounts  19xx / 19xx
 *
 * Sources are listed in the feature report (bas.se kontoplan, Skatteverket
 * SKV 282, Fortnox, Bokio and Spiris bookkeeping guides).
 *
 * A template only plans the entry. Saving goes through createJournalEntry in
 * lib/accounting/journal.ts like every other manual entry.
 */

import { z } from "zod";

import { ensureStandardAccounts, standardAccount, standardNameFor } from "@/lib/accounting/accounts";
import { createJournalEntry, JournalError, type JournalVatReturn } from "@/lib/accounting/journal";
import { asNumber, round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { invoiceOpenAmounts, invoiceOpenSelect } from "@/lib/invoices/balance";
import { calculateTotalDepreciation } from "@/lib/tax/depreciation";

export const JOURNAL_TEMPLATE_IDS = [
  "owner_withdrawal",
  "owner_deposit",
  "transfer",
  "bank_fee",
  "interest_received",
  "interest_paid",
  "loan_taken",
  "loan_repayment",
  "vat_settlement",
  "tax_payment",
  "depreciation",
  "year_end_receivables",
  "year_end_payables"
] as const;

export type JournalTemplateId = (typeof JOURNAL_TEMPLATE_IDS)[number];

export const isJournalTemplateId = (value: unknown): value is JournalTemplateId =>
  typeof value === "string" && (JOURNAL_TEMPLATE_IDS as readonly string[]).includes(value);

export type PlannedLine = { code: string; debit: number; credit: number };

export type PlannedEntry = {
  /** "reversal" is the 1 January entry that undoes a year-end entry. */
  role: "entry" | "reversal";
  /** YYYY-MM-DD. */
  txnDate: string;
  description: string;
  reference?: string;
  lines: PlannedLine[];
  vatReturn?: JournalVatReturn;
};

export type PlanNotice =
  /** The VAT accounts and the amount paid differ by more than rounding; the rest stays on 2650. */
  | { code: "VAT_DIFFERENCE"; ledgerNet: number; paid: number; difference: number }
  /** A whole-krona rounding difference was booked on 3740. */
  | { code: "VAT_ROUNDING"; amount: number }
  /** The VAT accounts were empty, so only the payment is booked. */
  | { code: "VAT_NOTHING_TO_CLEAR" };

export type TemplatePlan = {
  template: JournalTemplateId;
  entries: PlannedEntry[];
  notices: PlanNotice[];
};

// ─── Input schemas ───────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf()), "Choose a valid date.");
const amount = z.number().finite().positive("Enter an amount above zero.").max(1_000_000_000);
const optionalAmount = z.number().finite().min(0, "Amounts cannot be negative.").max(1_000_000_000).default(0);
const text = z.string().trim().max(120).optional();
const cashAccount = z.string().regex(/^19\d{2}$/, "Choose a bank or cash account (19xx).");
const year = z.number().int().min(1990).max(2100);

const simple = z.object({ date: isoDate, amount, bankAccount: cashAccount.default("1930"), text });

const schemas = {
  owner_withdrawal: simple,
  owner_deposit: simple,
  bank_fee: simple,
  interest_received: simple,
  interest_paid: simple,
  loan_taken: simple,
  transfer: z
    .object({ date: isoDate, amount, fromAccount: cashAccount, toAccount: cashAccount, text })
    .refine((value) => value.fromAccount !== value.toAccount, "Choose two different accounts."),
  loan_repayment: z
    .object({
      date: isoDate,
      amortization: optionalAmount,
      interest: optionalAmount,
      fee: optionalAmount,
      bankAccount: cashAccount.default("1930"),
      text
    })
    .refine((value) => value.amortization + value.interest + value.fee > 0, "Enter at least one amount."),
  vat_settlement: z.object({
    date: isoDate,
    kind: z.enum(["paid", "refund"]),
    amount,
    /** Last day of the VAT period the payment covers. */
    periodEnd: isoDate,
    bankAccount: cashAccount.default("1930")
  }),
  tax_payment: z.object({
    date: isoDate,
    amount,
    kind: z.enum(["preliminary", "other"]).default("preliminary"),
    /** The user has confirmed that this is booked as a private withdrawal, not a cost. */
    confirmPrivate: z.literal(true, { message: "Confirm that the tax is booked as a private withdrawal." }),
    bankAccount: cashAccount.default("1930"),
    text
  }),
  depreciation: z
    .object({
      year,
      equipment: optionalAmount,
      vehicle: optionalAmount,
      building: optionalAmount,
      intangible: optionalAmount
    })
    .refine((value) => value.equipment + value.vehicle + value.building + value.intangible > 0, "Enter at least one amount."),
  year_end_receivables: z
    .object({
      year,
      /** Unpaid customer invoices at 31 December, including VAT, per VAT rate. */
      sales25: optionalAmount,
      sales12: optionalAmount,
      sales6: optionalAmount,
      sales0: optionalAmount,
      reverse: z.boolean().default(true)
    })
    .refine((value) => value.sales25 + value.sales12 + value.sales6 + value.sales0 > 0, "Enter at least one amount."),
  year_end_payables: z.object({
    year,
    bills: z
      .array(
        z
          .object({
            text: z.string().trim().min(1, "Say who the bill is from.").max(80),
            /** Amount to pay, including VAT. */
            gross: amount,
            vat: optionalAmount,
            accountCode: z.string().regex(/^[4-8]\d{3}$/, "Choose the cost account for the bill.")
          })
          .refine((bill) => bill.vat < bill.gross, "The VAT cannot be as large as the whole bill.")
      )
      .min(1, "Add at least one bill.")
      .max(20),
    reverse: z.boolean().default(true)
  })
} satisfies Record<JournalTemplateId, z.ZodTypeAny>;

type Params<T extends JournalTemplateId> = z.infer<(typeof schemas)[T]>;

// ─── Small helpers ───────────────────────────────────────────────────────────

const toOre = (value: number) => Math.round(value * 100);
const fromOre = (ore: number) => ore / 100;
const debit = (code: string, value: number): PlannedLine => ({ code, debit: round2(value), credit: 0 });
const credit = (code: string, value: number): PlannedLine => ({ code, debit: 0, credit: round2(value) });
const nonZero = (lines: PlannedLine[]) => lines.filter((line) => line.debit !== 0 || line.credit !== 0);
const swap = (lines: PlannedLine[]): PlannedLine[] =>
  lines.map((line) => ({ code: line.code, debit: line.credit, credit: line.debit }));
const withText = (base: string, extra?: string) => (extra ? `${base}: ${extra}` : base).slice(0, 200);
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999Z`);

const DEPRECIATION_ACCOUNTS = {
  equipment: { cost: "7832", accumulated: "1229" },
  vehicle: { cost: "7834", accumulated: "1249" },
  building: { cost: "7840", accumulated: "1119" },
  intangible: { cost: "7810", accumulated: "1019" }
} as const;

export type DepreciationCategory = keyof typeof DEPRECIATION_ACCOUNTS;

const depreciationCategoryOf = (assetCategory: string): DepreciationCategory =>
  assetCategory === "vehicle" || assetCategory === "building" || assetCategory === "intangible"
    ? assetCategory
    : "equipment";

const SALES_BY_RATE = [
  { key: "sales25", rate: 0.25, percent: 25, sales: "3001", vat: "2610" },
  { key: "sales12", rate: 0.12, percent: 12, sales: "3041", vat: "2620" },
  { key: "sales6", rate: 0.06, percent: 6, sales: "3046", vat: "2630" },
  { key: "sales0", rate: 0, percent: 0, sales: "3051", vat: null }
] as const;

/** Stable references that tie a year-end entry to its 1 January reversal. */
export const yearEndReference = (kind: "AR" | "AP", yearValue: number, reversal = false) =>
  `BOKSLUT-${yearValue}-${kind}${reversal ? "-REV" : ""}`;

// ─── VAT account balances for the settlement ─────────────────────────────────

export type VatBalances = {
  /** Output VAT accounts (2610 to 2639): what is owed, positive when owed. */
  output: Array<{ code: string; amount: number }>;
  /** Input VAT accounts (2640 to 2649): what can be deducted, positive when deductible. */
  input: Array<{ code: string; amount: number }>;
  /** Output minus input. Positive: to pay. Negative: to get back. */
  net: number;
};

/**
 * What is on the VAT accounts for everything up to `periodEnd` that has not
 * been settled yet: every line dated on or before the period end, plus every
 * settlement (an entry that touches 2650) whenever it was booked. A settlement
 * for an earlier period paid after this period's end is thereby still counted.
 */
export const loadVatBalances = async (businessId: string, periodEnd: Date): Promise<VatBalances> => {
  const accounts = await prisma.account.findMany({
    where: { businessId, OR: ["261", "262", "263", "264"].map((prefix) => ({ code: { startsWith: prefix } })) },
    select: { id: true, code: true }
  });
  const vatAccounts = accounts.filter((account) => /^26[1-4]\d$/.test(account.code));
  if (vatAccounts.length === 0) return { output: [], input: [], net: 0 };

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: vatAccounts.map((account) => account.id) },
      transaction: {
        businessId,
        OR: [{ txnDate: { lte: periodEnd } }, { lines: { some: { account: { code: "2650" } } } }]
      }
    },
    _sum: { debit: true, credit: true }
  });
  const sumById = new Map(sums.map((row) => [row.accountId, row._sum]));

  const output: VatBalances["output"] = [];
  const input: VatBalances["input"] = [];
  let netOre = 0;
  for (const account of vatAccounts.sort((a, b) => a.code.localeCompare(b.code))) {
    const sum = sumById.get(account.id);
    const debitOre = toOre(asNumber(sum?.debit ?? 0));
    const creditOre = toOre(asNumber(sum?.credit ?? 0));
    if (account.code.startsWith("264")) {
      const ore = debitOre - creditOre;
      if (ore !== 0) input.push({ code: account.code, amount: fromOre(ore) });
      netOre -= ore;
    } else {
      const ore = creditOre - debitOre;
      if (ore !== 0) output.push({ code: account.code, amount: fromOre(ore) });
      netOre += ore;
    }
  }
  return { output, input, net: fromOre(netOre) };
};

/** A whole-krona return can differ from the öre in the ledger by a few kronor at most. */
const VAT_ROUNDING_LIMIT_ORE = 500;

const planVatSettlement = (params: Params<"vat_settlement">, balances: VatBalances, sv: boolean) => {
  const notices: PlanNotice[] = [];
  const lines: PlannedLine[] = [];

  // 1. Empty the VAT accounts into the settlement account 2650.
  for (const row of balances.output) lines.push(row.amount > 0 ? debit(row.code, row.amount) : credit(row.code, -row.amount));
  for (const row of balances.input) lines.push(row.amount > 0 ? credit(row.code, row.amount) : debit(row.code, -row.amount));
  const netOre = toOre(balances.net);
  if (netOre > 0) lines.push(credit("2650", fromOre(netOre)));
  if (netOre < 0) lines.push(debit("2650", fromOre(-netOre)));

  // 2. The payment to, or from, Skatteverket.
  const paidOre = toOre(params.amount) * (params.kind === "paid" ? 1 : -1);
  if (params.kind === "paid") {
    lines.push(debit("2650", params.amount), credit(params.bankAccount, params.amount));
  } else {
    lines.push(debit(params.bankAccount, params.amount), credit("2650", params.amount));
  }

  // 3. What is left on 2650.
  const differenceOre = netOre - paidOre;
  if (balances.output.length === 0 && balances.input.length === 0) {
    notices.push({ code: "VAT_NOTHING_TO_CLEAR" });
  } else if (differenceOre !== 0 && Math.abs(differenceOre) < VAT_ROUNDING_LIMIT_ORE) {
    const rounding = fromOre(Math.abs(differenceOre));
    if (differenceOre > 0) lines.push(debit("2650", rounding), credit("3740", rounding));
    else lines.push(debit("3740", rounding), credit("2650", rounding));
    notices.push({ code: "VAT_ROUNDING", amount: rounding });
  } else if (differenceOre !== 0) {
    notices.push({
      code: "VAT_DIFFERENCE",
      ledgerNet: balances.net,
      paid: fromOre(paidOre),
      difference: fromOre(differenceOre)
    });
  }

  const description =
    params.kind === "paid"
      ? sv
        ? `Moms betald till Skatteverket, period t.o.m. ${params.periodEnd}`
        : `VAT paid to Skatteverket, period ending ${params.periodEnd}`
      : sv
        ? `Moms tillbaka från Skatteverket, period t.o.m. ${params.periodEnd}`
        : `VAT refund from Skatteverket, period ending ${params.periodEnd}`;

  const entry: PlannedEntry = { role: "entry", txnDate: params.date, description, lines: nonZero(lines) };
  return { entries: [entry], notices };
};

// ─── Planning ────────────────────────────────────────────────────────────────

const parseParams = <T extends JournalTemplateId>(template: T, raw: unknown): Params<T> => {
  const parsed = schemas[template].safeParse(raw);
  if (!parsed.success) {
    throw new JournalError("INPUT", parsed.error.issues[0]?.message ?? "Check the form and try again.");
  }
  return parsed.data as Params<T>;
};

/**
 * Turn a filled-in guided form into the entries it will book. Nothing is
 * written. Descriptions are stored text, so they follow the language the
 * business keeps its books in.
 */
export const planTemplate = async (params: {
  businessId: string;
  template: JournalTemplateId;
  input: unknown;
}): Promise<TemplatePlan> => {
  const { businessId, template } = params;
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { locale: true } });
  const sv = business?.locale === "sv";
  const one = (entry: Omit<PlannedEntry, "role">): TemplatePlan => ({
    template,
    entries: [{ role: "entry", ...entry, lines: nonZero(entry.lines) }],
    notices: []
  });

  switch (template) {
    case "owner_withdrawal": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Eget uttag" : "Owner withdrawal", p.text),
        lines: [debit("2013", p.amount), credit(p.bankAccount, p.amount)]
      });
    }
    case "owner_deposit": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Egen insättning" : "Owner deposit", p.text),
        lines: [debit(p.bankAccount, p.amount), credit("2018", p.amount)]
      });
    }
    case "transfer": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Överföring mellan egna konton" : "Transfer between own accounts", p.text),
        lines: [debit(p.toAccount, p.amount), credit(p.fromAccount, p.amount)]
      });
    }
    case "bank_fee": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Bankavgift" : "Bank fee", p.text),
        lines: [debit("6570", p.amount), credit(p.bankAccount, p.amount)]
      });
    }
    case "interest_received": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Ränteintäkt" : "Interest received", p.text),
        lines: [debit(p.bankAccount, p.amount), credit("8310", p.amount)]
      });
    }
    case "interest_paid": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Räntekostnad" : "Interest paid", p.text),
        lines: [debit("8410", p.amount), credit(p.bankAccount, p.amount)]
      });
    }
    case "loan_taken": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Upptaget lån" : "Loan received", p.text),
        lines: [debit(p.bankAccount, p.amount), credit("2350", p.amount)]
      });
    }
    case "loan_repayment": {
      const p = parseParams(template, params.input);
      return one({
        txnDate: p.date,
        description: withText(sv ? "Amortering och ränta på lån" : "Loan repayment and interest", p.text),
        lines: [
          debit("2350", p.amortization),
          debit("8410", p.interest),
          debit("6570", p.fee),
          credit(p.bankAccount, p.amortization + p.interest + p.fee)
        ]
      });
    }
    case "tax_payment": {
      const p = parseParams(template, params.input);
      const base =
        p.kind === "preliminary"
          ? sv
            ? "Preliminärskatt betald från företagskontot (privat)"
            : "Preliminary tax paid from the business account (private)"
          : sv
            ? "Skatt betald från företagskontot (privat)"
            : "Tax paid from the business account (private)";
      return one({
        txnDate: p.date,
        description: withText(base, p.text),
        lines: [debit("2012", p.amount), credit(p.bankAccount, p.amount)]
      });
    }
    case "vat_settlement": {
      const p = parseParams(template, params.input);
      if (p.periodEnd > p.date) {
        throw new JournalError("INPUT", "The payment date cannot be before the end of the VAT period it covers.");
      }
      const balances = await loadVatBalances(businessId, endOfDay(p.periodEnd));
      return { template, ...planVatSettlement(p, balances, sv) };
    }
    case "depreciation": {
      const p = parseParams(template, params.input);
      const lines: PlannedLine[] = [];
      for (const category of Object.keys(DEPRECIATION_ACCOUNTS) as DepreciationCategory[]) {
        const value = p[category];
        if (value <= 0) continue;
        lines.push(debit(DEPRECIATION_ACCOUNTS[category].cost, value));
        lines.push(credit(DEPRECIATION_ACCOUNTS[category].accumulated, value));
      }
      return one({
        txnDate: `${p.year}-12-31`,
        description: sv ? `Årets avskrivningar ${p.year}` : `Depreciation for ${p.year}`,
        lines
      });
    }
    case "year_end_receivables": {
      const p = parseParams(template, params.input);
      const entries: PlannedEntry[] = [];
      for (const group of SALES_BY_RATE) {
        const gross = round2(p[group.key]);
        if (gross <= 0) continue;
        const net = round2(gross / (1 + group.rate));
        const vat = round2(gross - net);
        const rateText = group.percent === 0 ? (sv ? "utan moms" : "no VAT") : sv ? `${group.percent} % moms` : `${group.percent}% VAT`;
        const lines = nonZero([
          debit("1510", gross),
          credit(group.sales, net),
          ...(group.vat ? [credit(group.vat, vat)] : [])
        ]);
        entries.push({
          role: "entry",
          txnDate: `${p.year}-12-31`,
          description: sv
            ? `Obetalda kundfakturor 31 december ${p.year} (${rateText})`
            : `Unpaid customer invoices at 31 December ${p.year} (${rateText})`,
          reference: yearEndReference("AR", p.year),
          lines,
          vatReturn: { direction: "INCOME", netAmount: net, vatAmount: vat, vatRate: group.rate }
        });
        if (p.reverse) {
          entries.push({
            role: "reversal",
            txnDate: `${p.year + 1}-01-01`,
            description: sv
              ? `Återföring: obetalda kundfakturor 31 december ${p.year} (${rateText})`
              : `Reversal: unpaid customer invoices at 31 December ${p.year} (${rateText})`,
            reference: yearEndReference("AR", p.year, true),
            lines: swap(lines),
            vatReturn: { direction: "INCOME", netAmount: -net, vatAmount: -vat, vatRate: group.rate }
          });
        }
      }
      return { template, entries, notices: [] };
    }
    case "year_end_payables": {
      const p = parseParams(template, params.input);
      const entries: PlannedEntry[] = [];
      for (const bill of p.bills) {
        const gross = round2(bill.gross);
        const vat = round2(bill.vat);
        const net = round2(gross - vat);
        const lines = nonZero([debit(bill.accountCode, net), debit("2641", vat), credit("2440", gross)]);
        const vatRate = net > 0 ? Math.round((vat / net) * 10000) / 10000 : 0;
        entries.push({
          role: "entry",
          txnDate: `${p.year}-12-31`,
          description: withText(
            sv ? `Obetald leverantörsfaktura 31 december ${p.year}` : `Unpaid supplier bill at 31 December ${p.year}`,
            bill.text
          ),
          reference: yearEndReference("AP", p.year),
          lines,
          vatReturn: { direction: "EXPENSE", netAmount: net, vatAmount: vat, vatRate }
        });
        if (p.reverse) {
          entries.push({
            role: "reversal",
            txnDate: `${p.year + 1}-01-01`,
            description: withText(
              sv
                ? `Återföring: obetald leverantörsfaktura 31 december ${p.year}`
                : `Reversal: unpaid supplier bill at 31 December ${p.year}`,
              bill.text
            ),
            reference: yearEndReference("AP", p.year, true),
            lines: swap(lines),
            vatReturn: { direction: "EXPENSE", netAmount: -net, vatAmount: -vat, vatRate }
          });
        }
      }
      return { template, entries, notices: [] };
    }
  }
};

// ─── Preview ─────────────────────────────────────────────────────────────────

export type PreviewLine = PlannedLine & {
  name: string;
  type: string;
  /** The account does not exist yet and is created when the entry is saved. */
  isNew: boolean;
};

export type PreviewEntry = Omit<PlannedEntry, "lines" | "vatReturn"> & {
  lines: PreviewLine[];
  /** True when the entry is reported in the VAT return as a sale or a purchase. */
  inVatReturn: boolean;
  /** True when the date falls in a locked period, so saving will be refused. */
  locked: boolean;
};

/** The planned entries with account names, for "This is what will be booked". Writes nothing. */
export const previewTemplate = async (params: { businessId: string; template: JournalTemplateId; input: unknown }) => {
  const plan = await planTemplate(params);
  const codes = [...new Set(plan.entries.flatMap((entry) => entry.lines.map((line) => line.code)))];
  const [accounts, locks] = await Promise.all([
    prisma.account.findMany({
      where: { businessId: params.businessId, code: { in: codes } },
      select: { code: true, name: true, type: true, isActive: true }
    }),
    prisma.periodLock.findMany({ where: { businessId: params.businessId }, select: { periodStart: true, periodEnd: true } })
  ]);
  const byCode = new Map(accounts.map((account) => [account.code, account]));

  const entries: PreviewEntry[] = plan.entries.map((entry) => {
    const date = new Date(`${entry.txnDate}T00:00:00.000Z`);
    return {
      role: entry.role,
      txnDate: entry.txnDate,
      description: entry.description,
      reference: entry.reference,
      inVatReturn: entry.vatReturn !== undefined,
      locked: locks.some((lock) => lock.periodStart <= date && lock.periodEnd >= date),
      lines: entry.lines.map((line) => {
        const existing = byCode.get(line.code);
        const standard = standardAccount(line.code);
        if (!existing && !standard) {
          throw new JournalError("ACCOUNT_FOREIGN", `Account ${line.code} does not exist. Add it in the chart of accounts first.`);
        }
        if (existing && !existing.isActive) {
          throw new JournalError(
            "ACCOUNT_INACTIVE",
            `Account ${existing.code} ${existing.name} is inactive. Reactivate it in the chart of accounts or choose another account.`
          );
        }
        return {
          ...line,
          name: standardNameFor(line.code, existing?.name ?? null) ?? line.code,
          type: existing?.type ?? standard!.type,
          isNew: !existing
        };
      })
    };
  });

  return { template: plan.template, entries, notices: plan.notices };
};

// ─── Saving ──────────────────────────────────────────────────────────────────

/**
 * Book a guided entry. Missing standard accounts are created first, in the
 * same database transaction, so either everything is booked or nothing is.
 */
export const saveTemplate = async (params: {
  businessId: string;
  userId?: string | null;
  template: JournalTemplateId;
  input: unknown;
}) => {
  const plan = await planTemplate(params);
  if (plan.entries.length === 0) throw new JournalError("INPUT", "There is nothing to book.");
  const codes = plan.entries.flatMap((entry) => entry.lines.map((line) => line.code));

  const transactions = await prisma.$transaction(async (tx) => {
    let accounts;
    try {
      accounts = await ensureStandardAccounts(tx, { businessId: params.businessId, userId: params.userId, codes });
    } catch (error) {
      throw new JournalError("ACCOUNT_FOREIGN", error instanceof Error ? error.message : "Account not found.");
    }
    const created = [];
    for (const entry of plan.entries) {
      created.push(
        await createJournalEntry(tx, {
          businessId: params.businessId,
          userId: params.userId,
          txnDate: new Date(`${entry.txnDate}T00:00:00.000Z`),
          description: entry.description,
          reference: entry.reference,
          template: params.template,
          vatReturn: entry.vatReturn,
          lines: entry.lines.map((line) => ({
            accountId: accounts.get(line.code)!.id,
            debit: line.debit,
            credit: line.credit
          }))
        })
      );
    }
    return created;
  });

  return { plan, transactions };
};

// ─── Suggestions ─────────────────────────────────────────────────────────────

const yearEndDate = (yearValue: number) => new Date(Date.UTC(yearValue, 11, 31, 23, 59, 59, 999));
const yearStartDate = (yearValue: number) => new Date(Date.UTC(yearValue, 0, 1));

/** The year's depreciation from the fixed asset register, per kind of asset. */
export const suggestDepreciation = async (businessId: string, yearValue: number) => {
  const [assets, booked] = await Promise.all([
    prisma.fixedAsset.findMany({ where: { businessId }, orderBy: { acquisitionDate: "asc" } }),
    prisma.journalLine.aggregate({
      where: {
        account: { businessId, code: { in: Object.values(DEPRECIATION_ACCOUNTS).map((pair) => pair.cost) } },
        transaction: { businessId, txnDate: { gte: yearStartDate(yearValue), lte: yearEndDate(yearValue) } }
      },
      _sum: { debit: true, credit: true }
    })
  ]);

  const categoryById = new Map(assets.map((asset) => [asset.id, depreciationCategoryOf(asset.category)]));
  const { details } = calculateTotalDepreciation(
    assets.map((asset) => ({
      id: asset.id,
      description: asset.description,
      category: asset.category,
      acquisitionDate: asset.acquisitionDate,
      acquisitionCost: asset.acquisitionCost.toNumber(),
      depreciationMethod: asset.depreciationMethod,
      disposalDate: asset.disposalDate,
      disposalValue: asset.disposalValue?.toNumber() ?? null
    })),
    yearValue
  );

  const totals: Record<DepreciationCategory, number> = { equipment: 0, vehicle: 0, building: 0, intangible: 0 };
  const rows = details
    .filter((detail) => detail.yearDepreciation > 0)
    .map((detail) => {
      const category = categoryById.get(detail.assetId) ?? "equipment";
      totals[category] = round2(totals[category] + detail.yearDepreciation);
      return { description: detail.description, category, amount: detail.yearDepreciation, method: detail.method };
    });

  return {
    year: yearValue,
    totals,
    assets: rows,
    assetCount: assets.length,
    /** Depreciation already booked on the cost accounts this year. */
    alreadyBooked: round2(asNumber(booked._sum.debit ?? 0) - asNumber(booked._sum.credit ?? 0))
  };
};

const rateKeyOf = (rate: number): "sales25" | "sales12" | "sales6" | "sales0" | null => {
  const normalized = rate > 1 ? rate / 100 : rate;
  for (const group of SALES_BY_RATE) if (Math.abs(normalized - group.rate) < 0.0005) return group.key;
  return null;
};

/**
 * Customer invoices issued in or before the year that were still unpaid, in
 * full or in part, on 31 December. Only invoices in SEK with one of the
 * Swedish VAT rates are added up; the rest are listed for the user to add.
 *
 * ROT and RUT: the customer owes the invoice minus the tax reduction. The
 * reduction not yet paid out by Skatteverket on 31 December is also income
 * not yet received, and gets a row of its own (kind "skatteverket"). If
 * Skatteverket has paid less than requested, the difference is customer debt.
 */
export const suggestYearEndReceivables = async (businessId: string, yearValue: number) => {
  const end = yearEndDate(yearValue);
  const [business, invoices, alreadyBooked] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { bookkeepingMethod: true } }),
    prisma.invoice.findMany({
      where: { businessId, issueDate: { lte: end }, status: { not: "VOID" } },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        issueDate: true,
        vatRate: true,
        currency: true,
        ...invoiceOpenSelect(end),
        creditNotes: { where: { issueDate: { lte: end }, status: { not: "VOID" } }, select: { amount: true } }
      },
      orderBy: { issueDate: "asc" }
    }),
    prisma.transaction.count({
      where: { businessId, reference: yearEndReference("AR", yearValue), voidedAt: null, reversesTransactionId: null }
    })
  ]);

  const totals = { sales25: 0, sales12: 0, sales6: 0, sales0: 0 };
  const rows: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    issueDate: string;
    outstanding: number;
    currency: string;
    ratePercent: number;
    included: boolean;
    /** "skatteverket": a ROT/RUT reduction requested, or still to be requested, and not yet paid out. */
    kind: "customer" | "skatteverket";
  }> = [];

  for (const invoice of invoices) {
    // Marked paid without payment rows (older invoices): paid in full on the paid date.
    if (!invoice.rotRutType && invoice.status === "PAID" && (!invoice.paidAt || invoice.paidAt <= end)) continue;
    const open = invoiceOpenAmounts(invoice, end);

    const rate = asNumber(invoice.vatRate);
    const key = rateKeyOf(rate);
    const included = key !== null && invoice.currency === "SEK";
    const base = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString().slice(0, 10),
      currency: invoice.currency,
      ratePercent: Math.round((rate > 1 ? rate : rate * 100) * 100) / 100,
      included
    };
    if (open.customer > 0) {
      if (included) totals[key] = round2(totals[key] + open.customer);
      rows.push({ ...base, customerName: invoice.customerName, outstanding: open.customer, kind: "customer" });
    }
    if (open.skatteverket > 0) {
      if (included) totals[key] = round2(totals[key] + open.skatteverket);
      rows.push({
        ...base,
        customerName: `Skatteverket: ${invoice.rotRutType === "ROT" ? "rotavdrag" : "rutavdrag"}, ${invoice.customerName}`,
        outstanding: open.skatteverket,
        kind: "skatteverket"
      });
    }
  }

  return {
    year: yearValue,
    totals,
    invoices: rows,
    /** Under faktureringsmetoden invoices are booked when issued, so this step is not needed. */
    cashMethod: (business?.bookkeepingMethod ?? "kontantmetoden") === "kontantmetoden",
    alreadyBooked: alreadyBooked > 0
  };
};

/** True when unpaid supplier bills have already been booked for the year. */
export const yearEndPayablesBooked = async (businessId: string, yearValue: number) =>
  (await prisma.transaction.count({
    where: { businessId, reference: yearEndReference("AP", yearValue), voidedAt: null, reversesTransactionId: null }
  })) > 0;
