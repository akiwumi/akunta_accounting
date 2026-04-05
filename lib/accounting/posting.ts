import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { round2 } from "@/lib/accounting/math";
import { EntrySources, TransactionDirections, type EntrySource, type TransactionDirection } from "@/lib/domain/enums";
import { convertToSekAtDate, normalizeCurrency, type SupportedCurrency } from "@/lib/fx/sek";

type CreateCashTransactionInput = {
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
  bankAccountCode?: string;
  paidInvoiceId?: string;
};

type DraftLine = {
  accountId: string;
  debit: number;
  credit: number;
  note?: string;
};

const round4 = (value: number) => Math.round(value * 10000) / 10000;

const rebalanceLines = (lines: DraftLine[]) => {
  const debit = round2(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = round2(lines.reduce((sum, line) => sum + line.credit, 0));
  const diff = round2(debit - credit);

  if (diff === 0) return lines;

  const bankLineIndex = lines.findIndex((line) => line.note === "counterparty_bank");
  if (bankLineIndex === -1) {
    throw new Error(`Journal lines are not balanced (diff=${diff}) and no bank line was found.`);
  }

  if (diff > 0) {
    lines[bankLineIndex].credit = round2(lines[bankLineIndex].credit + diff);
  } else {
    lines[bankLineIndex].debit = round2(lines[bankLineIndex].debit + Math.abs(diff));
  }

  return lines;
};

export const createCashMethodTransaction = async (input: CreateCashTransactionInput) => {
  const bankAccountCode = input.bankAccountCode ?? "1930";
  const incomeAccountCode = input.incomeAccountCode ?? "3001";
  const expenseAccountCode = input.expenseAccountCode ?? "6110";

  const requiredCodes =
    input.direction === TransactionDirections.INCOME
      ? [bankAccountCode, "2610", incomeAccountCode]
      : [bankAccountCode, "2641", expenseAccountCode];

  const accounts = await prisma.account.findMany({
    where: {
      businessId: input.businessId,
      code: { in: requiredCodes }
    }
  });

  const lookup = new Map(accounts.map((account) => [account.code, account]));
  for (const code of requiredCodes) {
    if (!lookup.get(code)) {
      throw new Error(`Missing account ${code}. Ensure chart of accounts is initialized.`);
    }
  }

  const providedCurrency = normalizeCurrency(input.currency);
  let gross = round2(input.grossAmount);
  let net = input.netAmount !== undefined ? round2(input.netAmount) : undefined;
  let vat = input.vatAmount !== undefined ? round2(input.vatAmount) : undefined;
  let sourceCurrency: SupportedCurrency | null = input.sourceCurrency ?? null;
  let fxRateToSek = input.fxRateToSek ?? null;
  let fxRateDate = input.fxRateDate ?? null;

  if (providedCurrency !== "SEK") {
    const converted = await convertToSekAtDate({
      currency: providedCurrency,
      date: input.txnDate,
      grossAmount: gross,
      netAmount: net,
      vatAmount: vat
    });
    gross = converted.grossAmountSek;
    net = converted.netAmountSek;
    vat = converted.vatAmountSek;
    sourceCurrency = converted.sourceCurrency;
    fxRateToSek = converted.fxRateToSek;
    fxRateDate = converted.fxDate;
  }

  if (net === undefined && vat === undefined) {
    const configuredRate = input.vatRate !== undefined ? round4(Math.max(0, input.vatRate)) : 0;
    net = configuredRate > 0 ? round2(gross / (1 + configuredRate)) : gross;
    vat = round2(gross - net);
  } else if (net === undefined && vat !== undefined) {
    net = round2(gross - vat);
  } else if (net !== undefined && vat === undefined) {
    vat = round2(gross - net);
  }

  if (net === undefined || vat === undefined || net < 0 || vat < 0) {
    throw new Error("Invalid financial amounts for transaction posting.");
  }

  const residual = round2(gross - (net + vat));
  if (residual !== 0) {
    if (Math.abs(residual) <= 0.05) {
      vat = round2(vat + residual);
    } else if (input.vatAmount !== undefined) {
      net = round2(gross - vat);
    } else {
      vat = round2(gross - net);
    }
  }

  const vatRate =
    input.vatRate !== undefined
      ? round4(Math.max(0, input.vatRate))
      : net > 0
        ? round4(vat / net)
        : 0;

  const lines: DraftLine[] = [];

  if (input.direction === TransactionDirections.INCOME) {
    lines.push({
      accountId: lookup.get(bankAccountCode)!.id,
      debit: gross,
      credit: 0,
      note: "counterparty_bank"
    });
    lines.push({
      accountId: lookup.get(incomeAccountCode)!.id,
      debit: 0,
      credit: net
    });
    if (vat > 0) {
      lines.push({
        accountId: lookup.get("2610")!.id,
        debit: 0,
        credit: vat
      });
    }
  } else {
    lines.push({
      accountId: lookup.get(expenseAccountCode)!.id,
      debit: net,
      credit: 0
    });
    if (vat > 0) {
      lines.push({
        accountId: lookup.get("2641")!.id,
        debit: vat,
        credit: 0
      });
    }
    lines.push({
      accountId: lookup.get(bankAccountCode)!.id,
      debit: 0,
      credit: gross,
      note: "counterparty_bank"
    });
  }

  rebalanceLines(lines);

  const txData: Prisma.TransactionCreateInput = {
    business: { connect: { id: input.businessId } },
    receipt: input.receiptId ? { connect: { id: input.receiptId } } : undefined,
    paidInvoice: input.paidInvoiceId ? { connect: { id: input.paidInvoiceId } } : undefined,
    txnDate: input.txnDate,
    description: input.description,
    direction: input.direction,
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    vatRate,
    currency: "SEK",
    sourceCurrency: sourceCurrency ?? undefined,
    fxRateToSek: fxRateToSek ?? undefined,
    fxRateDate: fxRateDate ?? undefined,
    source: input.source,
    reference: input.reference,
    lines: {
      create: lines.map((line) => ({
        account: { connect: { id: line.accountId } },
        debit: line.debit,
        credit: line.credit,
        note: line.note
      }))
    }
  };

  return prisma.transaction.create({
    data: txData,
    include: {
      lines: {
        include: {
          account: true
        }
      }
    }
  });
};

export const isBalanced = (lines: { debit: number; credit: number }[]) => {
  const debit = round2(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = round2(lines.reduce((sum, line) => sum + line.credit, 0));
  return debit === credit;
};

export const parseDirectionFromAmount = (amount: number): TransactionDirection => {
  if (amount < 0) return TransactionDirections.EXPENSE;
  return TransactionDirections.INCOME;
};

export const normalizeGrossAmount = (amount: number) => round2(Math.abs(amount));

export { EntrySources, TransactionDirections };
