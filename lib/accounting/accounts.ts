/**
 * The chart of accounts of one business: listing with balances, the entries
 * on one account, and adding, renaming, deactivating and reactivating accounts.
 *
 * Rules:
 *   - An account is never deleted. One that is no longer wanted is deactivated:
 *     it disappears from pickers but stays in every report.
 *   - System accounts and the accounts the posting templates book on cannot be
 *     deactivated, because receipts, invoices, salaries and the guided journal
 *     entries would then book on an account the user has switched off.
 *   - The account number follows the BAS chart: four digits, first digit 1 to 8.
 *     The first digit (and for class 2 and 8 the second) suggests the type.
 */

import { type Prisma } from "@prisma/client";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { asNumber, round2 } from "@/lib/accounting/math";
import { getAccountBalances } from "@/lib/accounting/year-end";
import { prisma } from "@/lib/db";
import { AccountTypes, type AccountType } from "@/lib/domain/enums";

type Db = Prisma.TransactionClient;

export class AccountError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CODE"
      | "INVALID_NAME"
      | "INVALID_TYPE"
      | "DUPLICATE"
      | "NOT_FOUND"
      | "PROTECTED",
    message: string,
    public readonly status: number = 422
  ) {
    super(message);
    this.name = "AccountError";
  }
}

// ─── BAS classes ─────────────────────────────────────────────────────────────

export type BasClass = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

/** Plain-language names for the eight BAS account classes. */
export const BAS_CLASS_NAMES: Record<BasClass, { sv: string; en: string; svHint: string; enHint: string }> = {
  "1": {
    sv: "Det firman äger",
    en: "What the business owns",
    svHint: "Tillgångar: bankkonton, kundfordringar, lager och inventarier.",
    enHint: "Assets: bank accounts, money customers owe you, stock and equipment."
  },
  "2": {
    sv: "Eget kapital och skulder",
    en: "Your own capital and what the business owes",
    svHint: "Dina egna uttag och insättningar, lån, leverantörsskulder, moms och skatter.",
    enHint: "Your own withdrawals and deposits, loans, unpaid bills, VAT and taxes."
  },
  "3": {
    sv: "Det firman tjänar",
    en: "What the business earns",
    svHint: "Intäkter: försäljning och andra inkomster i verksamheten.",
    enHint: "Income: sales and other business income."
  },
  "4": {
    sv: "Varor och material",
    en: "Goods and materials",
    svHint: "Inköp av det du säljer vidare eller förbrukar i produktionen.",
    enHint: "Purchases of what you resell or use up in production."
  },
  "5": {
    sv: "Lokal, bil och förbrukning",
    en: "Premises, vehicles and consumables",
    svHint: "Övriga externa kostnader: hyra, el, bil, resor, förbrukningsinventarier.",
    enHint: "Other external costs: rent, electricity, vehicles, travel, small equipment."
  },
  "6": {
    sv: "Kontor, försäljning och tjänster",
    en: "Office, selling and services",
    svHint: "Övriga externa kostnader: telefon, försäkring, redovisning, bankavgifter.",
    enHint: "Other external costs: phone, insurance, accounting help, bank fees."
  },
  "7": {
    sv: "Personal och avskrivningar",
    en: "Staff and depreciation",
    svHint: "Löner, sociala avgifter och årets värdeminskning på inventarier.",
    enHint: "Salaries, social contributions and the year's loss of value on equipment."
  },
  "8": {
    sv: "Räntor och bokslut",
    en: "Interest and year-end items",
    svHint: "Ränteintäkter, räntekostnader och bokslutsposter.",
    enHint: "Interest received, interest paid and year-end items."
  }
};

export const basClassOf = (code: string): BasClass | null =>
  /^[1-8]\d{3}$/.test(code) ? (code[0] as BasClass) : null;

/**
 * The account type the BAS number implies.
 *
 * 20xx is equity and the rest of class 2 liabilities, except input VAT (264x),
 * which this app keeps as a claim on Skatteverket, the way the default chart
 * seeds 2641. Class 8 is financial income up to 83xx and costs from 84xx.
 */
export const suggestAccountType = (code: string): AccountType | null => {
  if (!/^[1-8]\d{3}$/.test(code)) return null;
  const n = Number(code);
  if (n < 2000) return AccountTypes.ASSET;
  if (n < 2100) return AccountTypes.EQUITY;
  if (n >= 2640 && n <= 2649) return AccountTypes.ASSET;
  if (n < 3000) return AccountTypes.LIABILITY;
  if (n < 4000) return AccountTypes.INCOME;
  if (n < 8000) return AccountTypes.EXPENSE;
  if (n < 8400) return AccountTypes.INCOME;
  return AccountTypes.EXPENSE;
};

// ─── Standard accounts the guided entries need ───────────────────────────────

export type StandardAccount = { code: string; name: string; type: AccountType };

/**
 * BAS accounts the guided journal entries book on that the default chart does
 * not seed. They are created for the business the first time one is needed.
 */
const EXTRA_STANDARD_ACCOUNTS: StandardAccount[] = [
  { code: "1019", name: "Ackumulerade avskrivningar immateriella tillgångar (Accumulated Amortisation - Intangibles)", type: AccountTypes.ASSET },
  { code: "1119", name: "Ackumulerade avskrivningar på byggnader (Accumulated Depreciation - Buildings)", type: AccountTypes.ASSET },
  { code: "1229", name: "Ackumulerade avskrivningar på inventarier (Accumulated Depreciation - Equipment)", type: AccountTypes.ASSET },
  { code: "1249", name: "Ackumulerade avskrivningar på bilar (Accumulated Depreciation - Vehicles)", type: AccountTypes.ASSET },
  { code: "1940", name: "Övriga bankkonton (Other Bank Account)", type: AccountTypes.ASSET },
  { code: "2012", name: "Avräkning för skatter och avgifter (Private Taxes Paid by the Business)", type: AccountTypes.EQUITY },
  { code: "2013", name: "Övriga egna uttag (Owner Withdrawals)", type: AccountTypes.EQUITY },
  { code: "2018", name: "Övriga egna insättningar (Owner Deposits)", type: AccountTypes.EQUITY },
  { code: "2350", name: "Andra långfristiga skulder till kreditinstitut (Bank Loans)", type: AccountTypes.LIABILITY },
  { code: "3740", name: "Öres- och kronutjämning (Rounding)", type: AccountTypes.INCOME }
];

/**
 * Names the default chart gave two accounts that mean something else in BAS.
 * An account that still carries the old name and has never been booked on is
 * renamed to the BAS name the first time a guided entry needs it.
 */
const LEGACY_SEED_NAMES: Record<string, string> = {
  "2013": "Årets resultat (Current Year Result)",
  "3740": "Erhållna rabatter (Discounts Received)"
};

export const standardAccount = (code: string): StandardAccount | null => {
  const extra = EXTRA_STANDARD_ACCOUNTS.find((account) => account.code === code);
  if (extra) return extra;
  const seeded = swedishSoleTraderDefaultAccounts.find((account) => account.code === code);
  if (seeded) return { code: seeded.code, name: seeded.name, type: seeded.type };
  return null;
};

/** The name an account will carry once a guided entry has used it. */
export const standardNameFor = (code: string, currentName: string | null): string | null => {
  if (currentName === null) return standardAccount(code)?.name ?? null;
  if (LEGACY_SEED_NAMES[code] === currentName) return standardAccount(code)?.name ?? currentName;
  return currentName;
};

/** Accounts the guided journal entries book on. */
export const JOURNAL_TEMPLATE_ACCOUNT_CODES = [
  "1019", "1119", "1229", "1249", "1510", "1930", "2012", "2013", "2018", "2350", "2440",
  "2610", "2620", "2630", "2641", "2650", "3001", "3041", "3046", "3051", "3740", "6570",
  "7810", "7832", "7834", "7840", "8310", "8410"
];

/** Accounts the receipt, invoice, salary and payment postings book on. */
const POSTING_TEMPLATE_ACCOUNT_CODES = [
  "1510", "1930", "2010", "2440", "2610", "2641", "2710", "2730", "3001", "3041", "3046", "3051",
  "4000", "5410", "5800", "5830", "6110", "6212", "6490", "6530", "6560", "6570", "7010", "7300",
  "7410", "7690"
];

const PROTECTED_CODES = new Set([...JOURNAL_TEMPLATE_ACCOUNT_CODES, ...POSTING_TEMPLATE_ACCOUNT_CODES]);

/** True when the account may not be deactivated. */
export const isProtectedAccount = (account: { code: string; isSystem: boolean }): boolean =>
  account.isSystem || PROTECTED_CODES.has(account.code);

/**
 * Make sure the business has every account in `codes`, creating missing ones
 * from the standard list. Returns the accounts by code.
 *
 * Runs inside the caller's database transaction, so an account created for an
 * entry that then fails is rolled back with it.
 */
export const ensureStandardAccounts = async (
  db: Db,
  params: { businessId: string; userId?: string | null; codes: string[] }
) => {
  const codes = [...new Set(params.codes)];
  const existing = await db.account.findMany({ where: { businessId: params.businessId, code: { in: codes } } });
  const byCode = new Map(existing.map((account) => [account.code, account]));

  for (const code of codes) {
    const found = byCode.get(code);
    const standard = standardAccount(code);

    if (!found) {
      if (!standard) {
        throw new AccountError("NOT_FOUND", `Account ${code} does not exist. Add it in the chart of accounts first.`, 404);
      }
      const created = await db.account.create({
        data: { businessId: params.businessId, code, name: standard.name, type: standard.type }
      });
      await writeLedgerAudit(db, {
        businessId: params.businessId,
        userId: params.userId,
        entityType: "Account",
        entityId: created.id,
        action: "CREATE",
        after: { code, name: standard.name, type: standard.type, reason: "Needed by a guided journal entry" }
      });
      byCode.set(code, created);
      continue;
    }

    if (standard && LEGACY_SEED_NAMES[code] === found.name) {
      const used = await db.journalLine.count({ where: { accountId: found.id } });
      const opening = await db.openingBalance.count({ where: { accountId: found.id } });
      if (used === 0 && opening === 0) {
        const renamed = await db.account.update({
          where: { id: found.id },
          data: { name: standard.name, type: standard.type }
        });
        await writeLedgerAudit(db, {
          businessId: params.businessId,
          userId: params.userId,
          entityType: "Account",
          entityId: found.id,
          action: "RENAME",
          before: { name: found.name, type: found.type },
          after: { name: standard.name, type: standard.type, reason: "Aligned with the BAS chart on first use" }
        });
        byCode.set(code, renamed);
      }
    }
  }

  return byCode;
};

// ─── Create, rename, deactivate ──────────────────────────────────────────────

const ACCOUNT_TYPES = new Set<string>(Object.values(AccountTypes));

const cleanName = (raw: string): string => {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new AccountError("INVALID_NAME", "Give the account a name of at least two characters.");
  if (name.length > 120) throw new AccountError("INVALID_NAME", "The account name can be at most 120 characters.");
  return name;
};

export const createAccount = async (params: {
  businessId: string;
  userId?: string | null;
  code: string;
  name: string;
  /** Defaults to the type the BAS number implies. */
  type?: string | null;
}) => {
  const code = params.code.trim();
  const suggested = suggestAccountType(code);
  if (!suggested) {
    throw new AccountError("INVALID_CODE", "The account number must be four digits and start with 1 to 8, as in the BAS chart.");
  }
  const name = cleanName(params.name);
  const type = params.type ?? suggested;
  if (!ACCOUNT_TYPES.has(type)) throw new AccountError("INVALID_TYPE", "Unknown account type.");

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.account.findUnique({
      where: { businessId_code: { businessId: params.businessId, code } },
      select: { name: true, isActive: true }
    });
    if (duplicate) {
      throw new AccountError(
        "DUPLICATE",
        duplicate.isActive
          ? `Account ${code} already exists: ${duplicate.name}.`
          : `Account ${code} already exists (${duplicate.name}) but is inactive. Reactivate it instead.`,
        409
      );
    }
    const account = await tx.account.create({ data: { businessId: params.businessId, code, name, type } });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.userId,
      entityType: "Account",
      entityId: account.id,
      action: "CREATE",
      after: { code, name, type }
    });
    return account;
  });
};

export const updateAccount = async (params: {
  businessId: string;
  userId?: string | null;
  accountId: string;
  name?: string;
  isActive?: boolean;
}) =>
  prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({ where: { id: params.accountId, businessId: params.businessId } });
    if (!account) throw new AccountError("NOT_FOUND", "Account not found.", 404);

    const data: { name?: string; isActive?: boolean } = {};
    if (params.name !== undefined) {
      const name = cleanName(params.name);
      if (name !== account.name) data.name = name;
    }
    if (params.isActive !== undefined && params.isActive !== account.isActive) {
      if (!params.isActive && isProtectedAccount(account)) {
        throw new AccountError(
          "PROTECTED",
          `Account ${account.code} is used when receipts, invoices, salaries or guided entries are booked, so it cannot be deactivated.`,
          409
        );
      }
      data.isActive = params.isActive;
    }
    if (Object.keys(data).length === 0) return account;

    const updated = await tx.account.update({ where: { id: account.id }, data });
    await writeLedgerAudit(tx, {
      businessId: params.businessId,
      userId: params.userId,
      entityType: "Account",
      entityId: account.id,
      action:
        data.isActive === undefined ? "RENAME" : data.isActive ? "REACTIVATE" : "DEACTIVATE",
      before: { code: account.code, name: account.name, isActive: account.isActive },
      after: { code: updated.code, name: updated.name, isActive: updated.isActive }
    });
    return updated;
  });

// ─── Listing with balances ───────────────────────────────────────────────────

const yearEndOf = (year: number) => new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
const yearStartOf = (year: number) => new Date(Date.UTC(year, 0, 1));
const isResultType = (type: string) => type === AccountTypes.INCOME || type === AccountTypes.EXPENSE;

export type AccountListRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isSystem: boolean;
  /** True when the account may not be deactivated. */
  isProtected: boolean;
  /** Number of journal lines ever booked on the account. */
  entryCount: number;
  /**
   * Balance in the account's natural direction. For what the business owns and
   * owes it is the balance at the end of the year; for income and costs it is
   * the year's total.
   */
  balance: number;
};

/**
 * Balance per account for one fiscal year (calendar year).
 *
 * getAccountBalances returns everything booked up to a date, plus opening
 * balances when the year before has been closed. Income and cost accounts
 * start each year at zero, so when no opening balances exist for the year the
 * part booked before the year is taken off again.
 */
export const accountBalancesForYear = async (businessId: string, year: number): Promise<Map<string, number>> => {
  const [atYearEnd, openingRows] = await Promise.all([
    getAccountBalances(businessId, yearEndOf(year), year),
    prisma.openingBalance.count({ where: { businessId, fiscalYear: year } })
  ]);
  const beforeYear = openingRows > 0 ? [] : await getAccountBalances(businessId, yearEndOf(year - 1));
  const before = new Map(beforeYear.map((row) => [row.accountId, row.balance]));

  const result = new Map<string, number>();
  for (const row of atYearEnd) {
    const earlier = isResultType(row.accountType) ? (before.get(row.accountId) ?? 0) : 0;
    result.set(row.accountId, round2(row.balance - earlier));
  }
  return result;
};

export const listAccountsWithBalances = async (businessId: string, year: number): Promise<AccountListRow[]> => {
  const [accounts, balances, counts] = await Promise.all([
    prisma.account.findMany({ where: { businessId }, orderBy: { code: "asc" } }),
    accountBalancesForYear(businessId, year),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { account: { businessId } },
      _count: { _all: true }
    })
  ]);
  const countById = new Map(counts.map((row) => [row.accountId, row._count._all]));

  return accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    isSystem: account.isSystem,
    isProtected: isProtectedAccount(account),
    entryCount: countById.get(account.id) ?? 0,
    balance: balances.get(account.id) ?? 0
  }));
};

// ─── One account's entries ───────────────────────────────────────────────────

export type AccountLedgerRow = {
  transactionId: string;
  verificationNumber: number;
  txnDate: Date;
  description: string;
  source: string;
  status: "ACTIVE" | "CANCELLED" | "CORRECTION";
  debit: number;
  credit: number;
  /** Balance after this line, in the account's natural direction. */
  balance: number;
};

/** The entries on one account in one year, oldest first, with a running balance. */
export const getAccountLedger = async (businessId: string, accountId: string, year: number) => {
  const account = await prisma.account.findFirst({ where: { id: accountId, businessId } });
  if (!account) return null;

  // What the account carried into the year. Income and cost accounts start at zero.
  let opening = 0;
  if (!isResultType(account.type)) {
    const dayBefore = new Date(yearStartOf(year).getTime() - 1);
    const balances = await getAccountBalances(businessId, dayBefore, year);
    opening = round2(balances.find((row) => row.accountId === accountId)?.balance ?? 0);
  }

  const lines = await prisma.journalLine.findMany({
    where: { accountId, transaction: { businessId, txnDate: { gte: yearStartOf(year), lte: yearEndOf(year) } } },
    select: {
      debit: true,
      credit: true,
      transaction: {
        select: {
          id: true,
          verificationNumber: true,
          txnDate: true,
          description: true,
          source: true,
          voidedAt: true,
          reversesTransactionId: true
        }
      }
    }
  });
  lines.sort(
    (a, b) =>
      a.transaction.txnDate.getTime() - b.transaction.txnDate.getTime() ||
      a.transaction.verificationNumber - b.transaction.verificationNumber
  );

  const debitNormal = account.type === AccountTypes.ASSET || account.type === AccountTypes.EXPENSE;
  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: AccountLedgerRow[] = lines.map((line) => {
    const debit = asNumber(line.debit);
    const credit = asNumber(line.credit);
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    running = round2(running + (debitNormal ? debit - credit : credit - debit));
    return {
      transactionId: line.transaction.id,
      verificationNumber: line.transaction.verificationNumber,
      txnDate: line.transaction.txnDate,
      description: line.transaction.description,
      source: line.transaction.source,
      status: line.transaction.voidedAt
        ? "CANCELLED"
        : line.transaction.reversesTransactionId
          ? "CORRECTION"
          : "ACTIVE",
      debit,
      credit,
      balance: running
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      isActive: account.isActive,
      isSystem: account.isSystem,
      isProtected: isProtectedAccount(account)
    },
    debitNormal,
    opening,
    closing: running,
    totalDebit,
    totalCredit,
    rows
  };
};
