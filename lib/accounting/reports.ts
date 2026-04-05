import { prisma } from "@/lib/db";
import { asNumber, round2 } from "@/lib/accounting/math";
import { AccountTypes, TransactionDirections, type AccountType } from "@/lib/domain/enums";

type PeriodInput = {
  businessId: string;
  from: Date;
  to: Date;
};

type AccountMovement = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  amount: number;
};

const accountSignedAmount = (type: AccountType, debit: number, credit: number): number => {
  if (type === AccountTypes.ASSET || type === AccountTypes.EXPENSE) {
    return round2(debit - credit);
  }
  return round2(credit - debit);
};

const fetchMovements = async ({ businessId, from, to }: PeriodInput): Promise<AccountMovement[]> => {
  const lines = await prisma.journalLine.findMany({
    where: {
      transaction: {
        businessId,
        txnDate: {
          gte: from,
          lte: to
        }
      }
    },
    include: {
      account: true
    }
  });

  const grouped = new Map<string, AccountMovement>();
  for (const line of lines) {
    const key = line.accountId;
    const existing = grouped.get(key);
    const debit = asNumber(line.debit as unknown as string | number);
    const credit = asNumber(line.credit as unknown as string | number);

    if (existing) {
      existing.debit = round2(existing.debit + debit);
      existing.credit = round2(existing.credit + credit);
      existing.amount = accountSignedAmount(existing.accountType, existing.debit, existing.credit);
      continue;
    }

    grouped.set(key, {
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: line.account.type as AccountType,
      debit,
      credit,
      amount: accountSignedAmount(line.account.type as AccountType, debit, credit)
    });
  }

  return [...grouped.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

export const buildProfitAndLoss = async (period: PeriodInput) => {
  const movements = await fetchMovements(period);
  const incomeAccounts = movements
    .filter((movement) => movement.accountType === AccountTypes.INCOME)
    .map((movement) => ({ ...movement, amount: Math.abs(movement.amount) }));
  const expenseAccounts = movements
    .filter((movement) => movement.accountType === AccountTypes.EXPENSE)
    .map((movement) => ({ ...movement, amount: Math.abs(movement.amount) }));

  const revenue = round2(incomeAccounts.reduce((sum, item) => sum + item.amount, 0));
  const expenses = round2(expenseAccounts.reduce((sum, item) => sum + item.amount, 0));
  const operatingProfit = round2(revenue - expenses);

  return {
    period,
    revenue,
    expenses,
    operatingProfit,
    incomeAccounts,
    expenseAccounts
  };
};

export const buildBalanceSheet = async (period: PeriodInput) => {
  const movements = await fetchMovements(period);
  const assets = movements
    .filter((movement) => movement.accountType === AccountTypes.ASSET)
    .map((movement) => ({ ...movement, amount: Math.abs(movement.amount) }));
  const liabilities = movements
    .filter((movement) => movement.accountType === AccountTypes.LIABILITY)
    .map((movement) => ({ ...movement, amount: Math.abs(movement.amount) }));
  const equity = movements
    .filter((movement) => movement.accountType === AccountTypes.EQUITY)
    .map((movement) => ({ ...movement, amount: Math.abs(movement.amount) }));

  const pnl = await buildProfitAndLoss(period);
  const currentYearResult = pnl.operatingProfit;

  const totalAssets = round2(assets.reduce((sum, item) => sum + item.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((sum, item) => sum + item.amount, 0));
  const totalEquity = round2(equity.reduce((sum, item) => sum + item.amount, 0));
  const liabilitiesAndEquity = round2(totalLiabilities + totalEquity + currentYearResult);

  return {
    period,
    assets,
    liabilities,
    equity,
    currentYearResult,
    totalAssets,
    totalLiabilities,
    totalEquity,
    liabilitiesAndEquity,
    difference: round2(totalAssets - liabilitiesAndEquity)
  };
};

export const buildVatReport = async (period: PeriodInput) => {
  const transactions = await prisma.transaction.findMany({
    where: {
      businessId: period.businessId,
      txnDate: {
        gte: period.from,
        lte: period.to
      }
    },
    select: {
      direction: true,
      vatAmount: true,
      netAmount: true,
      grossAmount: true
    }
  });

  let outputVat = 0;
  let inputVat = 0;
  let taxableSales = 0;
  let taxablePurchases = 0;

  for (const transaction of transactions) {
    const vatAmount = asNumber(transaction.vatAmount as unknown as string | number);
    const netAmount = asNumber(transaction.netAmount as unknown as string | number);

    if (transaction.direction === TransactionDirections.INCOME) {
      outputVat = round2(outputVat + vatAmount);
      taxableSales = round2(taxableSales + netAmount);
    } else if (transaction.direction === TransactionDirections.EXPENSE) {
      inputVat = round2(inputVat + vatAmount);
      taxablePurchases = round2(taxablePurchases + netAmount);
    }
  }

  return {
    period,
    taxableSales,
    taxablePurchases,
    outputVat,
    inputVat,
    vatPayable: round2(outputVat - inputVat)
  };
};

export const buildNeBilagaDraft = async (period: PeriodInput) => {
  const movements = await fetchMovements(period);
  const byPrefix = (prefixes: string[]) =>
    round2(
      movements
        .filter((movement) => prefixes.some((prefix) => movement.accountCode.startsWith(prefix)))
        .reduce((sum, movement) => sum + Math.abs(movement.amount), 0)
    );

  const revenueR10 = byPrefix(["30"]);
  const costOfGoodsR16 = byPrefix(["40"]);
  const externalCostsR17 = byPrefix(["50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69"]);
  const personnelR18 = byPrefix(["70", "71", "72", "73", "74", "75", "76"]);
  const depreciationR22 = byPrefix(["78"]);
  const interestIncomeR30 = byPrefix(["83"]);
  const interestExpenseR31 = byPrefix(["84"]);

  const resultR47 = round2(
    revenueR10 -
      costOfGoodsR16 -
      externalCostsR17 -
      personnelR18 -
      depreciationR22 +
      interestIncomeR30 -
      interestExpenseR31
  );

  return {
    period,
    lineItems: {
      R10_revenue: revenueR10,
      R16_costOfGoods: costOfGoodsR16,
      R17_externalCosts: externalCostsR17,
      R18_personnel: personnelR18,
      R22_depreciation: depreciationR22,
      R30_interestIncome: interestIncomeR30,
      R31_interestExpense: interestExpenseR31,
      R47_result: resultR47
    },
    notes: [
      "NE-bilaga line mapping is a draft and should be reviewed before filing.",
      "For Swedish filing, verify each account mapping to official tax form rows."
    ]
  };
};

export const buildDashboardSummary = async (period: PeriodInput) => {
  const [pnl, vat] = await Promise.all([buildProfitAndLoss(period), buildVatReport(period)]);

  return {
    revenue: pnl.revenue,
    expenses: pnl.expenses,
    operatingProfit: pnl.operatingProfit,
    vatPayable: vat.vatPayable,
    vatOutput: vat.outputVat,
    vatInput: vat.inputVat
  };
};
