/**
 * Year-end accounting workflows for Swedish sole traders.
 *
 * Implements:
 *   - getAccountBalances()   — running balance per account up to a given date
 *   - getOpeningBalances()   — retrieve stored opening balances for a fiscal year
 *   - upsertOpeningBalance() — manually set/override an opening balance
 *   - closeFiscalYear()      — lock the period, roll P&L into equity, and carry
 *                              forward balance-sheet account balances
 *
 * Swedish accounting notes:
 *   - Income and expense (P&L) accounts are "closed" at year-end: their net
 *     result is transferred to equity (default: account 2010 Eget kapital).
 *   - Balance sheet accounts (assets, liabilities, equity) carry their closing
 *     balance forward as the opening balance of the next fiscal year.
 *   - A PeriodLock is created spanning the entire fiscal year to prevent edits.
 */

import { Decimal } from "@prisma/client/runtime/library";

import { prisma } from "@/lib/db";
import { AccountTypes } from "@/lib/domain/enums";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountBalance {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  /** Positive = debit surplus, negative = credit surplus (raw signed balance). */
  balance: number;
}

export interface YearEndSummary {
  fiscalYear: number;
  openingBalancesCreated: number;
  periodLockCreated: boolean;
  netPnl: number;
  retainedEarningsAccountCode: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNumber = (d: Decimal | number | null | undefined): number => {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : parseFloat(d.toString());
};

/** Natural signed balance for an account type (debit-positive convention). */
function signedBalance(totalDebit: number, totalCredit: number, type: string): number {
  // Debit-normal: assets, expenses → balance = debit - credit
  // Credit-normal: liabilities, equity, income → balance = credit - debit
  if (type === AccountTypes.ASSET || type === AccountTypes.EXPENSE) {
    return totalDebit - totalCredit;
  }
  return totalCredit - totalDebit;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the running balance for every account in a business, summing all
 * journal lines where the transaction date is on or before `upToDate`.
 *
 * Opening balances (from a prior year-end close) are added on top.
 */
export async function getAccountBalances(
  businessId: string,
  upToDate: Date,
  fiscalYear?: number
): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { businessId },
    include: {
      lines: {
        where: {
          transaction: {
            businessId,
            txnDate: { lte: upToDate },
          },
        },
        select: { debit: true, credit: true },
      },
    },
    orderBy: { code: "asc" },
  });

  // Load opening balances for the fiscal year if provided
  const openingMap = new Map<string, number>();
  if (fiscalYear !== undefined) {
    const obRows = await prisma.openingBalance.findMany({
      where: { businessId, fiscalYear },
    });
    for (const ob of obRows) {
      openingMap.set(ob.accountId, toNumber(ob.amount));
    }
  }

  return accounts.map((acc) => {
    const totalDebit = acc.lines.reduce((s, l) => s + toNumber(l.debit), 0);
    const totalCredit = acc.lines.reduce((s, l) => s + toNumber(l.credit), 0);
    const journalBalance = signedBalance(totalDebit, totalCredit, acc.type);
    const openingBalance = openingMap.get(acc.id) ?? 0;
    return {
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      balance: journalBalance + openingBalance,
    };
  });
}

/**
 * Return stored opening balances for a fiscal year.
 */
export async function getOpeningBalances(
  businessId: string,
  fiscalYear: number
): Promise<Array<{ accountId: string; accountCode: string; accountName: string; fiscalYear: number; amount: number }>> {
  const rows = await prisma.openingBalance.findMany({
    where: { businessId, fiscalYear },
    include: { account: { select: { code: true, name: true } } },
    orderBy: { account: { code: "asc" } },
  });

  return rows.map((r) => ({
    accountId: r.accountId,
    accountCode: r.account.code,
    accountName: r.account.name,
    fiscalYear: r.fiscalYear,
    amount: toNumber(r.amount),
  }));
}

/**
 * Manually set or update an opening balance for a specific account and year.
 * Useful for importing historical data or correcting a prior year-end close.
 */
export async function upsertOpeningBalance(
  businessId: string,
  accountId: string,
  fiscalYear: number,
  amount: number
): Promise<void> {
  // Verify account belongs to business
  const account = await prisma.account.findFirst({
    where: { id: accountId, businessId },
  });
  if (!account) throw new Error(`Account ${accountId} not found for this business.`);

  await prisma.openingBalance.upsert({
    where: { businessId_accountId_fiscalYear: { businessId, accountId, fiscalYear } },
    create: { businessId, accountId, fiscalYear, amount },
    update: { amount },
  });
}

/**
 * Close a fiscal year:
 *
 * 1. Validate: no existing period lock for this year, no future lock conflict.
 * 2. Calculate closing balances at the last day of the fiscal year.
 * 3. Compute net P&L (income − expense closing balances).
 * 4. Transfer net P&L to the retained earnings / equity account.
 * 5. Create OpeningBalance rows for balance-sheet accounts in the next year.
 * 6. Create PeriodLock covering the full fiscal year.
 *
 * @param businessId
 * @param fiscalYear          The year being closed (e.g. 2024).
 * @param retainedEarningsAccountCode  Chart of accounts code for equity carry-forward (default "2010").
 */
export async function closeFiscalYear(
  businessId: string,
  fiscalYear: number,
  retainedEarningsAccountCode = "2010"
): Promise<YearEndSummary> {
  const yearStart = new Date(Date.UTC(fiscalYear, 0, 1));
  const yearEnd = new Date(Date.UTC(fiscalYear, 11, 31, 23, 59, 59, 999));
  const nextYearStart = fiscalYear + 1;

  // ── Guard: existing period lock ───────────────────────────────────────────
  const existingLock = await prisma.periodLock.findFirst({
    where: {
      businessId,
      periodStart: { lte: yearEnd },
      periodEnd: { gte: yearStart },
    },
  });
  if (existingLock) {
    throw new Error(
      `A period lock already exists that overlaps with fiscal year ${fiscalYear}.`
    );
  }

  // ── Guard: retained earnings account must exist ───────────────────────────
  const retainedEarningsAccount = await prisma.account.findFirst({
    where: { businessId, code: retainedEarningsAccountCode },
  });
  if (!retainedEarningsAccount) {
    throw new Error(
      `Retained earnings account ${retainedEarningsAccountCode} not found. ` +
        "Check the account code or create the account first."
    );
  }

  // ── Calculate closing balances at year end ────────────────────────────────
  const balances = await getAccountBalances(businessId, yearEnd, fiscalYear);

  // ── Compute net P&L ───────────────────────────────────────────────────────
  // Income is credit-normal so positive balance = income; expense is debit-normal.
  // Net P&L = total income balance - total expense balance
  let totalIncome = 0;
  let totalExpense = 0;
  for (const b of balances) {
    if (b.accountType === AccountTypes.INCOME) totalIncome += b.balance;
    if (b.accountType === AccountTypes.EXPENSE) totalExpense += b.balance;
  }
  const netPnl = totalIncome - totalExpense;

  // ── Create opening balances for next year ─────────────────────────────────
  // Balance sheet accounts (asset, liability, equity) carry forward.
  // P&L accounts zero out; their net is added to the equity account instead.
  const balanceSheetTypes = new Set<string>([
    AccountTypes.ASSET,
    AccountTypes.LIABILITY,
    AccountTypes.EQUITY,
  ]);

  const openingRows: Array<{ businessId: string; accountId: string; fiscalYear: number; amount: number }> = [];

  for (const b of balances) {
    if (!balanceSheetTypes.has(b.accountType)) continue;
    if (b.balance === 0) continue;

    let carryAmount = b.balance;

    // Add net P&L to the retained earnings account
    if (b.accountId === retainedEarningsAccount.id) {
      carryAmount += netPnl;
    }

    openingRows.push({
      businessId,
      accountId: b.accountId,
      fiscalYear: nextYearStart,
      amount: carryAmount,
    });
  }

  // If the retained earnings account had zero journal activity but there is
  // a P&L result, still create an opening balance entry for it.
  const alreadyIncluded = openingRows.some(
    (r) => r.accountId === retainedEarningsAccount.id
  );
  if (!alreadyIncluded && netPnl !== 0) {
    openingRows.push({
      businessId,
      accountId: retainedEarningsAccount.id,
      fiscalYear: nextYearStart,
      amount: netPnl,
    });
  }

  // ── Persist in a transaction ──────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Upsert opening balances (idempotent)
    for (const row of openingRows) {
      await tx.openingBalance.upsert({
        where: {
          businessId_accountId_fiscalYear: {
            businessId: row.businessId,
            accountId: row.accountId,
            fiscalYear: row.fiscalYear,
          },
        },
        create: row,
        update: { amount: row.amount },
      });
    }

    // Create period lock for the closed year
    await tx.periodLock.create({
      data: { businessId, periodStart: yearStart, periodEnd: yearEnd },
    });
  });

  return {
    fiscalYear,
    openingBalancesCreated: openingRows.length,
    periodLockCreated: true,
    netPnl,
    retainedEarningsAccountCode,
  };
}
