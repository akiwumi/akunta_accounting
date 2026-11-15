/**
 * Integration tests for the ledger rules (bokföringslagen ch. 5).
 *
 * They run against a real PostgreSQL database built from prisma/migrations, so
 * they cover the database triggers as well as the application code.
 *
 *   npm run test            (see scripts/test.sh: creates and drops akunta_test)
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { LedgerError, voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { buildBalanceSheet, buildProfitAndLoss, buildVatReport } from "@/lib/accounting/reports";
import { closeFiscalYear } from "@/lib/accounting/year-end";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run ledger tests against "${dbName}". Use a database whose name ends in _test.`);
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const yearRange = (year: number) => ({ from: day(`${year}-01-01`), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) });

let businessId = "";

const book = (overrides: Partial<Parameters<typeof createCashMethodTransaction>[0]> = {}) =>
  createCashMethodTransaction({
    businessId,
    txnDate: day("2031-03-10"),
    description: "Test entry",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 1250,
    vatRate: 0.25,
    source: EntrySources.MANUAL,
    ...overrides
  });

before(async () => {
  const business = await prisma.business.create({
    data: {
      name: "Ledger Test AB",
      fiscalYearStart: day("2031-01-01"),
      accounts: {
        create: swedishSoleTraderDefaultAccounts.map((a) => ({
          code: a.code,
          name: a.name,
          type: a.type,
          vatCode: a.vatCode,
          isSystem: a.isSystem ?? false
        }))
      }
    }
  });
  businessId = business.id;
});

after(async () => {
  await prisma.$disconnect();
});

test("verification numbers are assigned by the database in an unbroken series", async () => {
  const first = await book();
  const second = await book({ grossAmount: 500 });
  assert.equal(first.verificationNumber, 1);
  assert.equal(second.verificationNumber, 2);

  // A failed insert must not burn a number.
  await assert.rejects(
    prisma.transaction.create({
      data: {
        businessId,
        txnDate: day("2031-03-11"),
        description: "Unbalanced",
        direction: "EXPENSE",
        grossAmount: 100,
        netAmount: 100,
        vatAmount: 0,
        vatRate: 0,
        source: "MANUAL",
        lines: { create: [{ accountId: first.lines[0].accountId, debit: 100, credit: 0 }] }
      }
    }),
    /LEDGER_UNBALANCED/
  );
  const third = await book({ grossAmount: 250 });
  assert.equal(third.verificationNumber, 3);
});

test("concurrent bookings never share a verification number", async () => {
  const created = await Promise.all(Array.from({ length: 8 }, (_, i) => book({ grossAmount: 10 + i })));
  const numbers = created.map((t) => t.verificationNumber).sort((a, b) => a - b);
  assert.equal(new Set(numbers).size, 8);
  assert.equal(numbers[7] - numbers[0], 7);
});

test("a booked entry cannot be deleted or have its amounts changed", async () => {
  const entry = await book();
  await assert.rejects(prisma.transaction.delete({ where: { id: entry.id } }), /LEDGER_IMMUTABLE/);
  await assert.rejects(
    prisma.transaction.update({ where: { id: entry.id }, data: { grossAmount: 1 } }),
    /LEDGER_IMMUTABLE/
  );
  await assert.rejects(prisma.journalLine.deleteMany({ where: { transactionId: entry.id } }), /LEDGER_IMMUTABLE/);
  await assert.rejects(
    prisma.journalLine.updateMany({ where: { transactionId: entry.id }, data: { debit: 1 } }),
    /LEDGER_IMMUTABLE/
  );
  // Text may still be corrected.
  await prisma.transaction.update({ where: { id: entry.id }, data: { description: "Corrected text" } });
});

test("journal lines must be non-negative and one-sided", async () => {
  const entry = await book();
  const accountId = entry.lines[0].accountId;
  await assert.rejects(
    prisma.journalLine.create({ data: { transactionId: entry.id, accountId, debit: -5, credit: 0 } }),
    /JournalLine_amounts_check/
  );
  await assert.rejects(
    prisma.journalLine.create({ data: { transactionId: entry.id, accountId, debit: 5, credit: 5 } }),
    /JournalLine_amounts_check/
  );
});

test("cancelling books a reversal and the pair nets to zero in every report", async () => {
  const range = yearRange(2032);
  const baseline = await buildProfitAndLoss({ businessId, ...range });
  const baselineVat = await buildVatReport({ businessId, ...range });

  const entry = await book({ txnDate: day("2032-05-05"), grossAmount: 1250 });
  const { reversal } = await prisma.$transaction((tx) =>
    voidTransaction(tx, { businessId, transactionId: entry.id, reason: "Booked twice" })
  );

  assert.equal(reversal.verificationNumber, entry.verificationNumber + 1);
  assert.equal(reversal.reversesTransactionId, entry.id);
  assert.equal(Number(reversal.grossAmount), -1250);

  const original = await prisma.transaction.findUniqueOrThrow({ where: { id: entry.id } });
  assert.ok(original.voidedAt);
  assert.equal(original.voidReason, "Booked twice");

  const pnl = await buildProfitAndLoss({ businessId, ...range });
  assert.equal(pnl.expenses, baseline.expenses);
  assert.deepEqual(await buildVatReport({ businessId, ...range }), baselineVat);

  const audit = await prisma.auditLog.findFirst({ where: { businessId, entityId: entry.id, action: "VOID" } });
  assert.ok(audit, "cancelling must write an audit row");

  // Neither half of the pair can be cancelled again.
  await assert.rejects(
    prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: entry.id, reason: "again" })),
    LedgerError
  );
  await assert.rejects(
    prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: reversal.id, reason: "again" })),
    LedgerError
  );
});

test("the balance sheet balances, carries opening balances and keeps signs", async () => {
  // 2033: one sale and one larger purchase, so the bank account goes negative.
  await book({ txnDate: day("2033-02-01"), direction: TransactionDirections.INCOME, grossAmount: 1000 });
  await book({ txnDate: day("2033-02-02"), direction: TransactionDirections.EXPENSE, grossAmount: 50000, vatRate: 0 });

  const sheet2033 = await buildBalanceSheet({ businessId, ...yearRange(2033) });
  assert.equal(sheet2033.difference, 0);
  const bank2033 = sheet2033.assets.find((a) => a.accountCode === "1930");
  assert.ok(bank2033 && bank2033.amount < 0, "an overdrawn bank account must show as negative");

  await closeFiscalYear(businessId, 2033);

  // 2034: a single sale. The bank balance must be last year's closing balance plus 2000.
  await book({ txnDate: day("2034-01-15"), direction: TransactionDirections.INCOME, grossAmount: 2000, vatRate: 0 });
  const sheet2034 = await buildBalanceSheet({ businessId, ...yearRange(2034) });
  assert.equal(sheet2034.difference, 0);
  const bank2034 = sheet2034.assets.find((a) => a.accountCode === "1930");
  assert.equal(bank2034?.amount, bank2033.amount + 2000);
  assert.equal(sheet2034.currentYearResult, 2000);
});

test("nothing can be booked into, moved into or moved out of a locked period", async () => {
  // 2033 was locked by the year-end close above.
  await assert.rejects(book({ txnDate: day("2033-06-01") }), LedgerError);
  await assert.rejects(
    prisma.transaction.create({
      data: {
        businessId,
        txnDate: day("2033-06-01"),
        description: "Bypass",
        direction: "EXPENSE",
        grossAmount: 0,
        netAmount: 0,
        vatAmount: 0,
        vatRate: 0,
        source: "MANUAL"
      }
    }),
    /LEDGER_PERIOD_LOCKED/
  );

  const open = await book({ txnDate: day("2034-02-01") });
  await assert.rejects(
    prisma.transaction.update({ where: { id: open.id }, data: { txnDate: day("2033-12-31") } }),
    /LEDGER_PERIOD_LOCKED/
  );

  const locked = await prisma.transaction.findFirstOrThrow({
    where: { businessId, txnDate: { gte: day("2033-01-01"), lte: day("2033-12-31") }, voidedAt: null }
  });
  await assert.rejects(
    prisma.transaction.update({ where: { id: locked.id }, data: { txnDate: day("2034-03-01") } }),
    /LEDGER_PERIOD_LOCKED/
  );
});

test("cancelling an entry in a locked period books the correction in the open period", async () => {
  const locked = await prisma.transaction.findFirstOrThrow({
    where: { businessId, txnDate: { gte: day("2033-01-01"), lte: day("2033-12-31") }, voidedAt: null }
  });
  const before2033 = await buildProfitAndLoss({ businessId, ...yearRange(2033) });

  const { reversal } = await prisma.$transaction((tx) =>
    voidTransaction(tx, { businessId, transactionId: locked.id, reason: "Found after closing" })
  );

  assert.ok(reversal.txnDate.getUTCFullYear() !== 2033, "the correction must not land in the closed year");
  assert.deepEqual(await buildProfitAndLoss({ businessId, ...yearRange(2033) }), before2033);
});

test("row level security is enabled on every table", async () => {
  const open = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`;
  assert.deepEqual(open, []);
});
