/**
 * Accrual-basis posting (fakturametoden).
 * Revenue is recognised when invoiced; expenses when incurred, regardless of cash movement.
 *
 * Key differences from cash-basis:
 *  - Income posting creates an Accounts Receivable entry (1510) instead of hitting bank (1930).
 *  - Expense posting creates an Accounts Payable entry (2440) instead of hitting bank (1930).
 *  - A separate "settlement" posting moves the amount from AR/AP to bank when cash actually moves.
 */

import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { round2 } from "@/lib/accounting/math";
import { EntrySources, TransactionDirections, type EntrySource, type TransactionDirection } from "@/lib/domain/enums";
import { convertToSekAtDate, normalizeCurrency, type SupportedCurrency } from "@/lib/fx/sek";

type CreateAccrualTransactionInput = {
  businessId: string;
  txnDate: Date;
  description: string;
  direction: TransactionDirection;
  grossAmount: number;
  vatRate?: number;
  netAmount?: number;
  vatAmount?: number;
  source: EntrySource;
  receiptId?: string;
  reference?: string;
  currency?: string;
  sourceCurrency?: SupportedCurrency;
  fxRateToSek?: number;
  fxRateDate?: Date;
  incomeAccountCode?: string;
  expenseAccountCode?: string;
  /** Override the default AR/AP counterparty account */
  counterpartyAccountCode?: string;
  paidInvoiceId?: string;
};

type SettlementInput = {
  businessId: string;
  txnDate: Date;
  description: string;
  direction: TransactionDirection;
  grossAmount: number;
  bankAccountCode?: string;
  /** AR account (income settlement) or AP account (expense settlement) */
  counterpartyAccountCode?: string;
  source: EntrySource;
  reference?: string;
  paidInvoiceId?: string;
};

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Post income/expense recognition without touching bank. */
export const createAccrualTransaction = async (input: CreateAccrualTransactionInput) => {
  const arAccountCode = input.counterpartyAccountCode ?? (input.direction === TransactionDirections.INCOME ? "1510" : "2440");
  const incomeAccountCode = input.incomeAccountCode ?? "3001";
  const expenseAccountCode = input.expenseAccountCode ?? "6110";

  const requiredCodes =
    input.direction === TransactionDirections.INCOME
      ? [arAccountCode, "2610", incomeAccountCode]
      : [arAccountCode, "2641", expenseAccountCode];

  const accounts = await prisma.account.findMany({
    where: { businessId: input.businessId, code: { in: requiredCodes } }
  });
  const lookup = new Map(accounts.map((a) => [a.code, a]));
  for (const code of requiredCodes) {
    if (!lookup.get(code)) throw new Error(`Missing account ${code}. Ensure chart of accounts is initialised.`);
  }

  const providedCurrency = normalizeCurrency(input.currency);
  let gross = round2(input.grossAmount);
  let net = input.netAmount !== undefined ? round2(input.netAmount) : undefined;
  let vat = input.vatAmount !== undefined ? round2(input.vatAmount) : undefined;

  if (providedCurrency !== "SEK") {
    const converted = await convertToSekAtDate({ currency: providedCurrency, date: input.txnDate, grossAmount: gross, netAmount: net, vatAmount: vat });
    gross = converted.grossAmountSek;
    net = converted.netAmountSek;
    vat = converted.vatAmountSek;
  }

  if (net === undefined && vat === undefined) {
    const rate = input.vatRate !== undefined ? round4(Math.max(0, input.vatRate)) : 0;
    net = rate > 0 ? round2(gross / (1 + rate)) : gross;
    vat = round2(gross - net);
  } else if (net === undefined) {
    net = round2(gross - vat!);
  } else if (vat === undefined) {
    vat = round2(gross - net);
  }

  const vatRate = input.vatRate !== undefined ? round4(Math.max(0, input.vatRate)) : net! > 0 ? round4(vat! / net!) : 0;

  const lines: { accountId: string; debit: number; credit: number; note?: string }[] = [];

  if (input.direction === TransactionDirections.INCOME) {
    // DR Accounts Receivable (1510), CR Revenue + Output VAT
    lines.push({ accountId: lookup.get(arAccountCode)!.id, debit: gross, credit: 0, note: "counterparty_ar" });
    lines.push({ accountId: lookup.get(incomeAccountCode)!.id, debit: 0, credit: net! });
    if (vat! > 0) lines.push({ accountId: lookup.get("2610")!.id, debit: 0, credit: vat! });
  } else {
    // DR Expense + Input VAT, CR Accounts Payable (2440)
    lines.push({ accountId: lookup.get(expenseAccountCode)!.id, debit: net!, credit: 0 });
    if (vat! > 0) lines.push({ accountId: lookup.get("2641")!.id, debit: vat!, credit: 0 });
    lines.push({ accountId: lookup.get(arAccountCode)!.id, debit: 0, credit: gross, note: "counterparty_ap" });
  }

  const txData: Prisma.TransactionCreateInput = {
    business: { connect: { id: input.businessId } },
    receipt: input.receiptId ? { connect: { id: input.receiptId } } : undefined,
    paidInvoice: input.paidInvoiceId ? { connect: { id: input.paidInvoiceId } } : undefined,
    txnDate: input.txnDate,
    description: input.description,
    direction: input.direction,
    grossAmount: gross,
    netAmount: net!,
    vatAmount: vat!,
    vatRate,
    currency: "SEK",
    source: input.source,
    reference: input.reference,
    lines: { create: lines.map((l) => ({ account: { connect: { id: l.accountId } }, debit: l.debit, credit: l.credit, note: l.note })) }
  };

  return prisma.transaction.create({ data: txData, include: { lines: { include: { account: true } } } });
};

/** Settle a receivable or payable when cash moves to/from bank. */
export const createSettlementTransaction = async (input: SettlementInput) => {
  const bankCode = input.bankAccountCode ?? "1930";
  const counterpartyCode = input.counterpartyAccountCode ?? (input.direction === TransactionDirections.INCOME ? "1510" : "2440");

  const accounts = await prisma.account.findMany({
    where: { businessId: input.businessId, code: { in: [bankCode, counterpartyCode] } }
  });
  const lookup = new Map(accounts.map((a) => [a.code, a]));
  if (!lookup.get(bankCode)) throw new Error(`Missing account ${bankCode}.`);
  if (!lookup.get(counterpartyCode)) throw new Error(`Missing account ${counterpartyCode}.`);

  const gross = round2(input.grossAmount);

  const lines =
    input.direction === TransactionDirections.INCOME
      ? [
          { accountId: lookup.get(bankCode)!.id, debit: gross, credit: 0, note: "bank_settlement" },
          { accountId: lookup.get(counterpartyCode)!.id, debit: 0, credit: gross }
        ]
      : [
          { accountId: lookup.get(counterpartyCode)!.id, debit: gross, credit: 0 },
          { accountId: lookup.get(bankCode)!.id, debit: 0, credit: gross, note: "bank_settlement" }
        ];

  const txData: Prisma.TransactionCreateInput = {
    business: { connect: { id: input.businessId } },
    paidInvoice: input.paidInvoiceId ? { connect: { id: input.paidInvoiceId } } : undefined,
    txnDate: input.txnDate,
    description: input.description,
    direction: input.direction,
    grossAmount: gross,
    netAmount: gross,
    vatAmount: 0,
    vatRate: 0,
    currency: "SEK",
    source: input.source,
    reference: input.reference,
    lines: { create: lines.map((l) => ({ account: { connect: { id: l.accountId } }, debit: l.debit, credit: l.credit, note: l.note })) }
  };

  return prisma.transaction.create({ data: txData, include: { lines: { include: { account: true } } } });
};

export { EntrySources, TransactionDirections };
