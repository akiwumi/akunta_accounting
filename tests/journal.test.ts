/**
 * Integration tests for manual journal entries and the chart of accounts.
 *
 * They run against a real PostgreSQL database built from prisma/migrations
 * (see scripts/test.sh), so the database triggers are part of what is tested.
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  AccountError,
  createAccount,
  getAccountLedger,
  listAccountsWithBalances,
  suggestAccountType,
  updateAccount
} from "@/lib/accounting/accounts";
import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { JournalError, postJournalEntries, type JournalErrorCode } from "@/lib/accounting/journal";
import {
  JOURNAL_TEMPLATE_IDS,
  previewTemplate,
  saveTemplate,
  suggestDepreciation,
  suggestYearEndReceivables,
  type JournalTemplateId
} from "@/lib/accounting/journalTemplates";
import { voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/accounting/reports";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { buildMomsdeklaration } from "@/lib/tax/momsdeklaration";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run journal tests against "${dbName}". Use a database whose name ends in _test.`);
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const yearRange = (year: number) => ({ from: day(`${year}-01-01`), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) });
const monthRange = (year: number, month: number) => ({
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
});

let businessId = "";
let otherBusinessId = "";

const seedAccounts = () =>
  swedishSoleTraderDefaultAccounts.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    vatCode: a.vatCode,
    isSystem: a.isSystem ?? false
  }));

const accountId = async (code: string, business = businessId) =>
  (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: business, code } } })).id;

/** Sum of debit minus credit on one account over all entries. */
const netDebit = async (code: string) => {
  const sum = await prisma.journalLine.aggregate({
    where: { account: { businessId, code } },
    _sum: { debit: true, credit: true }
  });
  return Math.round((Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0)) * 100) / 100;
};

/** The year's balance of one account, signed, as the chart of accounts page shows it. */
const yearBalance = async (year: number, code: string) =>
  (await listAccountsWithBalances(businessId, year)).find((account) => account.code === code)?.balance ?? 0;

const save = (template: JournalTemplateId, input: unknown) => saveTemplate({ businessId, template, input });

/** "1930 D 500.00 | 2013 C 500.00", sorted, for compact comparisons. */
const shape = (transaction: { lines: Array<{ debit: unknown; credit: unknown; account: { code: string } }> }) =>
  transaction.lines
    .map((line) =>
      Number(line.debit) > 0
        ? `${line.account.code} D ${Number(line.debit).toFixed(2)}`
        : `${line.account.code} C ${Number(line.credit).toFixed(2)}`
    )
    .sort()
    .join(" | ");

const assertBalanced = (transaction: { lines: Array<{ debit: unknown; credit: unknown }> }) => {
  const debit = transaction.lines.reduce((sum, line) => sum + Math.round(Number(line.debit) * 100), 0);
  const credit = transaction.lines.reduce((sum, line) => sum + Math.round(Number(line.credit) * 100), 0);
  assert.equal(debit, credit, "the entry must balance");
  assert.ok(debit > 0, "the entry must have an amount");
};

const rejectsWith = (promise: Promise<unknown>, code: JournalErrorCode, message?: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof JournalError, `expected a JournalError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });

before(async () => {
  const business = await prisma.business.create({
    data: { name: "Journal Test", fiscalYearStart: day("2041-01-01"), locale: "sv", accounts: { create: seedAccounts() } }
  });
  businessId = business.id;
  const other = await prisma.business.create({
    data: { name: "Someone Else", fiscalYearStart: day("2041-01-01"), accounts: { create: seedAccounts() } }
  });
  otherBusinessId = other.id;
});

after(async () => {
  await prisma.$disconnect();
});

// ─── Guided templates ────────────────────────────────────────────────────────

test("each simple guided template books a balanced entry on the expected accounts", async () => {
  const cases: Array<{ template: JournalTemplateId; input: Record<string, unknown>; lines: string }> = [
    { template: "owner_withdrawal", input: { amount: 5000 }, lines: "1930 C 5000.00 | 2013 D 5000.00" },
    { template: "owner_deposit", input: { amount: 20000 }, lines: "1930 D 20000.00 | 2018 C 20000.00" },
    { template: "bank_fee", input: { amount: 99 }, lines: "1930 C 99.00 | 6570 D 99.00" },
    { template: "interest_received", input: { amount: 12.34 }, lines: "1930 D 12.34 | 8310 C 12.34" },
    { template: "interest_paid", input: { amount: 45.5 }, lines: "1930 C 45.50 | 8410 D 45.50" },
    { template: "loan_taken", input: { amount: 100000 }, lines: "1930 D 100000.00 | 2350 C 100000.00" },
    {
      template: "loan_repayment",
      input: { amortization: 2000, interest: 350.25, fee: 25 },
      lines: "1930 C 2375.25 | 2350 D 2000.00 | 6570 D 25.00 | 8410 D 350.25"
    },
    {
      template: "tax_payment",
      input: { amount: 4200, kind: "preliminary", confirmPrivate: true },
      lines: "1930 C 4200.00 | 2012 D 4200.00"
    },
    {
      template: "transfer",
      input: { amount: 3000, fromAccount: "1930", toAccount: "1940" },
      lines: "1930 C 3000.00 | 1940 D 3000.00"
    }
  ];

  for (const { template, input, lines } of cases) {
    const { transactions } = await save(template, { date: "2041-02-10", ...input });
    assert.equal(transactions.length, 1, template);
    const [entry] = transactions;
    assertBalanced(entry);
    assert.equal(shape(entry), lines, template);
    assert.equal(entry.source, EntrySources.JOURNAL, template);
    assert.equal(entry.direction, TransactionDirections.TRANSFER, template);
    assert.equal(Number(entry.vatAmount), 0, template);
    assert.equal(Number(entry.grossAmount), Number(entry.netAmount), template);
    assert.ok(entry.verificationNumber > 0, "the database assigns the verification number");

    const audit = await prisma.auditLog.findFirst({ where: { businessId, entityId: entry.id, action: "JOURNAL_ENTRY" } });
    assert.ok(audit, `${template}: a journal entry must write an audit row`);
    assert.match(audit.afterJson ?? "", new RegExp(`"template":"${template}"`));
  }

  // Every template id is covered by a test in this file.
  const covered = new Set([...cases.map((c) => c.template), "vat_settlement", "depreciation", "year_end_receivables", "year_end_payables"]);
  assert.deepEqual([...JOURNAL_TEMPLATE_IDS].filter((id) => !covered.has(id)), []);
});

test("accounts the default chart lacks are created on first use, with BAS names", async () => {
  const byCode = async (code: string) =>
    prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } });

  // 2012, 2013 and 2018 are part of the default chart; the rest were created by the entries above.
  assert.equal((await byCode("2018")).type, "EQUITY");
  assert.equal((await byCode("2012")).type, "EQUITY");
  assert.equal((await byCode("2350")).type, "LIABILITY");
  assert.equal((await byCode("1940")).type, "ASSET");
  // In BAS 2013 is the owner's withdrawals.
  assert.match((await byCode("2013")).name, /egna uttag/i);

  // The preview says so before anything is saved, and writes nothing.
  const before = await prisma.account.count({ where: { businessId: otherBusinessId } });
  const preview = await previewTemplate({
    businessId: otherBusinessId,
    template: "loan_taken",
    input: { date: "2041-02-10", amount: 100 }
  });
  const loanLine = preview.entries[0].lines.find((line) => line.code === "2350");
  assert.equal(loanLine?.isNew, true);
  assert.ok((loanLine?.name ?? "").length > 0);
  assert.equal(await prisma.account.count({ where: { businessId: otherBusinessId } }), before);
});

test("a withdrawal is not a cost and the balance sheet still balances", async () => {
  const pnl = await buildProfitAndLoss({ businessId, ...yearRange(2041) });
  // Only the bank fee (99), the two interest costs (45.50 + 350.25), the loan fee (25) and interest income (12.34).
  assert.equal(pnl.expenses, 519.75);
  assert.equal(pnl.revenue, 12.34);
  const sheet = await buildBalanceSheet({ businessId, ...yearRange(2041) });
  assert.equal(sheet.difference, 0);
});

test("tax paid from the business account needs the private-withdrawal confirmation", async () => {
  await rejectsWith(save("tax_payment", { date: "2041-03-12", amount: 1000, kind: "preliminary" }), "INPUT", /private/i);
  await rejectsWith(
    save("tax_payment", { date: "2041-03-12", amount: 1000, kind: "preliminary", confirmPrivate: false }),
    "INPUT"
  );
});

test("guided forms reject missing or impossible amounts", async () => {
  await rejectsWith(save("owner_withdrawal", { date: "2041-03-12", amount: 0 }), "INPUT");
  await rejectsWith(save("owner_withdrawal", { date: "2041-03-12", amount: -5 }), "INPUT");
  await rejectsWith(save("owner_withdrawal", { date: "12 mars", amount: 5 }), "INPUT");
  await rejectsWith(save("loan_repayment", { date: "2041-03-12" }), "INPUT");
  await rejectsWith(save("transfer", { date: "2041-03-12", amount: 5, fromAccount: "1930", toAccount: "1930" }), "INPUT");
  await rejectsWith(save("transfer", { date: "2041-03-12", amount: 5, fromAccount: "1930", toAccount: "3001" }), "INPUT");
});

test("depreciation is suggested from the asset register and booked per kind of asset", async () => {
  await prisma.fixedAsset.createMany({
    data: [
      { businessId, description: "Kamera", category: "equipment", acquisitionDate: day("2041-03-01"), acquisitionCost: 40000, depreciationMethod: "straight_20" },
      { businessId, description: "Skåpbil", category: "vehicle", acquisitionDate: day("2041-05-01"), acquisitionCost: 100000, depreciationMethod: "straight_20" }
    ]
  });

  const suggestion = await suggestDepreciation(businessId, 2041);
  assert.equal(suggestion.totals.equipment, 8000);
  assert.equal(suggestion.totals.vehicle, 20000);
  assert.equal(suggestion.alreadyBooked, 0);

  const { transactions } = await save("depreciation", { year: 2041, ...suggestion.totals });
  const [entry] = transactions;
  assertBalanced(entry);
  assert.equal(shape(entry), "1229 C 8000.00 | 1249 C 20000.00 | 7832 D 8000.00 | 7834 D 20000.00");
  assert.equal(entry.txnDate.toISOString().slice(0, 10), "2041-12-31");

  assert.equal((await suggestDepreciation(businessId, 2041)).alreadyBooked, 28000);
});

// ─── Free entries: what is refused ───────────────────────────────────────────

const free = async (
  lines: Array<{ code: string; debit?: number; credit?: number; business?: string }>,
  overrides: { txnDate?: Date; description?: string; acknowledgeVatWarning?: boolean } = {}
) =>
  postJournalEntries([
    {
      businessId,
      txnDate: overrides.txnDate ?? day("2041-04-01"),
      description: overrides.description ?? "Fri bokföringsorder",
      acknowledgeVatWarning: overrides.acknowledgeVatWarning,
      lines: await Promise.all(
        lines.map(async (line) => ({
          accountId: await accountId(line.code, line.business ?? businessId),
          debit: line.debit ?? 0,
          credit: line.credit ?? 0
        }))
      )
    }
  ]);

test("a free entry with several lines is booked as written", async () => {
  const [entry] = await free([
    { code: "6110", debit: 300 },
    { code: "6212", debit: 200.5 },
    { code: "1930", credit: 500.5 }
  ]);
  assertBalanced(entry);
  assert.equal(shape(entry), "1930 C 500.50 | 6110 D 300.00 | 6212 D 200.50");
  assert.equal(Number(entry.grossAmount), 500.5);
});

test("unbalanced, one-line and malformed entries are refused with a clear message", async () => {
  const count = () => prisma.transaction.count({ where: { businessId } });
  const before = await count();

  await rejectsWith(free([{ code: "6110", debit: 300 }, { code: "1930", credit: 250 }]), "UNBALANCED", /differ by 50\.00/);
  await rejectsWith(free([{ code: "6110", debit: 300 }]), "TOO_FEW_LINES", /at least two lines/);
  await rejectsWith(free([{ code: "6110", debit: -300 }, { code: "1930", credit: -300 }]), "LINE_AMOUNT", /negative/);
  await rejectsWith(
    free([{ code: "6110", debit: 300, credit: 300 }, { code: "1930", credit: 300, debit: 300 }]),
    "LINE_AMOUNT",
    /either debit or credit/
  );
  await rejectsWith(free([{ code: "6110", debit: 300 }, { code: "1930" }, { code: "1910", credit: 300 }]), "LINE_AMOUNT", /no amount/);
  await rejectsWith(free([{ code: "6110", debit: 300 }, { code: "1930", credit: 300 }], { description: "   " }), "DESCRIPTION");
  await rejectsWith(
    free([{ code: "6110", debit: 300 }, { code: "1930", credit: 300 }], { txnDate: new Date("nonsense") }),
    "DATE"
  );

  assert.equal(await count(), before, "a refused entry must leave nothing behind");
});

test("an account from another business is refused", async () => {
  await rejectsWith(
    free([{ code: "6110", debit: 300 }, { code: "1930", credit: 300, business: otherBusinessId }]),
    "ACCOUNT_FOREIGN",
    /does not exist in this business/
  );
});

test("an inactive account is refused until it is reactivated", async () => {
  const id = await accountId("6150");
  await updateAccount({ businessId, accountId: id, isActive: false });
  await rejectsWith(free([{ code: "6150", debit: 300 }, { code: "1930", credit: 300 }]), "ACCOUNT_INACTIVE", /6150.*inactive/);
  await updateAccount({ businessId, accountId: id, isActive: true });
  const [entry] = await free([{ code: "6150", debit: 300 }, { code: "1930", credit: 300 }]);
  assertBalanced(entry);
});

test("nothing is booked into a locked period, and a failed pair leaves nothing behind", async () => {
  await prisma.periodLock.create({
    data: { businessId, periodStart: day("2040-01-01"), periodEnd: new Date(Date.UTC(2040, 11, 31, 23, 59, 59, 999)) }
  });
  await rejectsWith(
    free([{ code: "6110", debit: 300 }, { code: "1930", credit: 300 }], { txnDate: day("2040-06-01") }),
    "LOCKED",
    /locked accounting period/
  );
  await rejectsWith(save("owner_withdrawal", { date: "2040-06-01", amount: 100 }), "LOCKED");

  // Year-end entry for 2039 with its reversal on 1 January 2040: the reversal is locked, so neither is booked.
  const before = await prisma.transaction.count({ where: { businessId } });
  await rejectsWith(save("year_end_receivables", { year: 2039, sales25: 1250, reverse: true }), "LOCKED");
  assert.equal(await prisma.transaction.count({ where: { businessId } }), before);

  const preview = await previewTemplate({
    businessId,
    template: "year_end_receivables",
    input: { year: 2039, sales25: 1250, reverse: true }
  });
  assert.deepEqual(preview.entries.map((entry) => entry.locked), [false, true]);
});

test("a journal entry is cancelled like any other entry", async () => {
  const before = await netDebit("2013");
  const { transactions } = await save("owner_withdrawal", { date: "2041-04-15", amount: 777 });
  assert.equal(await netDebit("2013"), before + 777);
  const { reversal } = await prisma.$transaction((tx) =>
    voidTransaction(tx, { businessId, transactionId: transactions[0].id, reason: "Wrong amount" })
  );
  assert.equal(reversal.reversesTransactionId, transactions[0].id);
  assert.equal(await netDebit("2013"), before);
});

// ─── VAT ─────────────────────────────────────────────────────────────────────

const sale = (iso: string, grossAmount: number, vatRate = 0.25) =>
  createCashMethodTransaction({
    businessId,
    txnDate: day(iso),
    description: "Försäljning",
    direction: TransactionDirections.INCOME,
    grossAmount,
    vatRate,
    source: EntrySources.MANUAL
  });

const purchase = (iso: string, grossAmount: number, vatRate = 0.25) =>
  createCashMethodTransaction({
    businessId,
    txnDate: day(iso),
    description: "Inköp",
    direction: TransactionDirections.EXPENSE,
    grossAmount,
    vatRate,
    source: EntrySources.MANUAL
  });

test("a free entry on a VAT account is refused unless the warning is acknowledged, and why", async () => {
  const period = monthRange(2042, 1);
  await sale("2042-01-10", 1250);
  assert.equal((await buildMomsdeklaration({ businessId, ...period })).crossCheck.ok, true);

  const lines = [{ code: "1930", debit: 250 }, { code: "2610", credit: 250 }];
  await rejectsWith(free(lines, { txnDate: day("2042-01-20") }), "VAT_ACCOUNTS", /receipt, payment or invoice/);

  // Acknowledged, it is booked, and the VAT return then shows the mismatch the warning describes.
  const [entry] = await free(lines, { txnDate: day("2042-01-20"), acknowledgeVatWarning: true });
  const broken = await buildMomsdeklaration({ businessId, ...period });
  assert.equal(broken.crossCheck.ok, false);
  assert.equal(broken.crossCheck.outputDifference, -250);

  await prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: entry.id, reason: "Test" }));
  assert.equal((await buildMomsdeklaration({ businessId, ...period })).crossCheck.ok, true);
});

test("the VAT settlement empties the VAT accounts and does not disturb the VAT return", async () => {
  // February 2042: sales 10 000 + 25 % and 1 120 incl. 12 %, a purchase of 2 500 incl. 25 %.
  const february = monthRange(2042, 2);
  await sale("2042-02-03", 12500);
  await sale("2042-02-04", 1120, 0.12);
  await purchase("2042-02-05", 2500);
  // January's sale (250 output VAT) is also still unsettled.

  const before = await buildMomsdeklaration({ businessId, ...february });
  assert.equal(before.crossCheck.ok, true);
  assert.equal(before.boxes["49"], 2500 + 120 - 500);

  // Paid on 12 March for everything up to the end of February: 250 + 2 500 + 120 - 500 = 2 370.
  const preview = await previewTemplate({
    businessId,
    template: "vat_settlement",
    input: { date: "2042-03-12", kind: "paid", amount: 2370, periodEnd: "2042-02-28" }
  });
  assert.deepEqual(preview.notices, []);

  // A sale in March, before the payment is booked, must not be swept into the settlement.
  await sale("2042-03-02", 625);

  const { transactions } = await save("vat_settlement", {
    date: "2042-03-12",
    kind: "paid",
    amount: 2370,
    periodEnd: "2042-02-28"
  });
  const [entry] = transactions;
  assertBalanced(entry);
  assert.equal(
    shape(entry),
    "1930 C 2370.00 | 2610 D 2870.00 | 2641 C 500.00 | 2650 C 2370.00 | 2650 D 2370.00"
  );
  assert.equal(entry.direction, TransactionDirections.TRANSFER);

  // The settlement account is back at zero and only March's VAT is left on 2610.
  assert.equal(await netDebit("2650"), 0);
  assert.equal(await netDebit("2610"), -125);
  assert.equal(await netDebit("2641"), 0);

  // February's return is unchanged, and March (where the settlement is dated) still agrees with the ledger.
  const afterFebruary = await buildMomsdeklaration({ businessId, ...february });
  assert.deepEqual(afterFebruary.boxes, before.boxes);
  assert.equal(afterFebruary.crossCheck.ok, true);
  const march = await buildMomsdeklaration({ businessId, ...monthRange(2042, 3) });
  assert.equal(march.crossCheck.ok, true);
  assert.equal(march.boxes["10"], 125);
  assert.equal(march.blockers.filter((blocker) => blocker.id === "ledgerMismatch").length, 0);
});

test("the VAT settlement books whole-krona rounding on 3740 and flags a real difference", async () => {
  // April 2042: output VAT 125.40 on top of March's 125.00.
  await sale("2042-04-06", 627);
  const input = { date: "2042-05-12", kind: "paid", amount: 250, periodEnd: "2042-04-30" };

  const preview = await previewTemplate({ businessId, template: "vat_settlement", input });
  assert.deepEqual(preview.notices, [{ code: "VAT_ROUNDING", amount: 0.4 }]);

  const { transactions } = await save("vat_settlement", input);
  assertBalanced(transactions[0]);
  assert.equal(
    shape(transactions[0]),
    "1930 C 250.00 | 2610 D 250.40 | 2650 C 250.40 | 2650 D 0.40 | 2650 D 250.00 | 3740 C 0.40"
  );
  assert.equal(await netDebit("2650"), 0);
  assert.equal(await netDebit("2610"), 0);
  assert.match(
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code: "3740" } } })).name,
    /kronutjämning/i
  );

  // A refund that does not match the books: the difference stays on 2650 and the preview says so.
  await purchase("2042-06-01", 5000);
  const refund = await previewTemplate({
    businessId,
    template: "vat_settlement",
    input: { date: "2042-07-12", kind: "refund", amount: 900, periodEnd: "2042-06-30" }
  });
  assert.deepEqual(refund.notices, [{ code: "VAT_DIFFERENCE", ledgerNet: -1000, paid: -900, difference: -100 }]);
  assert.equal((await buildMomsdeklaration({ businessId, ...monthRange(2042, 5) })).crossCheck.ok, true);
});

// ─── Year end under kontantmetoden ───────────────────────────────────────────

test("unpaid customer invoices at year end and their reversal net to zero across the two years", async () => {
  assert.equal(await yearBalance(2043, "3001"), 0);

  const { transactions } = await save("year_end_receivables", { year: 2043, sales25: 12500, sales0: 800, reverse: true });
  assert.equal(transactions.length, 4);
  for (const entry of transactions) assertBalanced(entry);

  const [accrual25, reversal25, accrual0, reversal0] = transactions;
  assert.equal(accrual25.txnDate.toISOString().slice(0, 10), "2043-12-31");
  assert.equal(reversal25.txnDate.toISOString().slice(0, 10), "2044-01-01");
  assert.equal(shape(accrual25), "1510 D 12500.00 | 2610 C 2500.00 | 3001 C 10000.00");
  assert.equal(shape(reversal25), "1510 C 12500.00 | 2610 D 2500.00 | 3001 D 10000.00");
  assert.equal(shape(accrual0), "1510 D 800.00 | 3051 C 800.00");
  assert.equal(shape(reversal0), "1510 C 800.00 | 3051 D 800.00");

  // Income lands in the year the work was invoiced and is taken out of the next.
  // (Read per account: buildProfitAndLoss shows each account's amount without its sign.)
  assert.equal(await yearBalance(2043, "3001"), 10000);
  assert.equal(await yearBalance(2044, "3001"), -10000);
  assert.equal(await yearBalance(2043, "3051"), 800);
  assert.equal(await yearBalance(2044, "3051"), -800);
  assert.equal((await buildProfitAndLoss({ businessId, ...yearRange(2043) })).revenue, 10800);

  // The receivable is on the balance sheet at 31 December and gone on 1 January.
  const sheet2043 = await buildBalanceSheet({ businessId, ...yearRange(2043) });
  assert.equal(sheet2043.assets.find((row) => row.accountCode === "1510")?.amount, 13300);
  assert.equal(sheet2043.difference, 0);
  assert.equal(await netDebit("1510"), 0);

  // The VAT belongs in the last return of the year, and the return still agrees with the ledger.
  const december = await buildMomsdeklaration({ businessId, ...monthRange(2043, 12) });
  assert.equal(december.boxes["05"], 10000);
  assert.equal(december.boxes["10"], 2500);
  assert.equal(december.crossCheck.ok, true);
  const january = await buildMomsdeklaration({ businessId, ...monthRange(2044, 1) });
  assert.equal(january.boxes["10"], -2500);
  assert.equal(january.crossCheck.ok, true);

  // When the customer pays in January the two cancel out: no VAT twice.
  await sale("2044-01-20", 12500);
  const afterPayment = await buildMomsdeklaration({ businessId, ...monthRange(2044, 1) });
  assert.equal(afterPayment.boxes["05"], 0);
  assert.equal(afterPayment.boxes["10"], 0);
  assert.equal(afterPayment.crossCheck.ok, true);
});

test("unpaid supplier bills at year end and their reversal net to zero across the two years", async () => {
  const { transactions } = await save("year_end_payables", {
    year: 2043,
    bills: [
      { text: "Telia", gross: 625, vat: 125, accountCode: "6212" },
      { text: "Försäkring", gross: 1800, vat: 0, accountCode: "6310" }
    ],
    reverse: true
  });
  assert.equal(transactions.length, 4);
  for (const entry of transactions) assertBalanced(entry);
  assert.equal(shape(transactions[0]), "2440 C 625.00 | 2641 D 125.00 | 6212 D 500.00");
  assert.equal(shape(transactions[1]), "2440 D 625.00 | 2641 C 125.00 | 6212 C 500.00");
  assert.equal(shape(transactions[2]), "2440 C 1800.00 | 6310 D 1800.00");
  assert.match(transactions[0].description, /Telia/);

  assert.equal(await yearBalance(2043, "6212"), 500);
  assert.equal(await yearBalance(2044, "6212"), -500);
  assert.equal(await yearBalance(2043, "6310"), 1800);
  assert.equal(await yearBalance(2044, "6310"), -1800);
  assert.equal(await netDebit("2440"), 0);

  const december = await buildMomsdeklaration({ businessId, ...monthRange(2043, 12) });
  assert.equal(december.boxes["48"], 125);
  assert.equal(december.crossCheck.ok, true);
  assert.equal((await buildMomsdeklaration({ businessId, ...monthRange(2044, 1) })).crossCheck.ok, true);
});

test("unpaid customer invoices are suggested from the invoice register", async () => {
  const invoice = (number: string, issue: string, gross: number, extra: Record<string, unknown> = {}) =>
    prisma.invoice.create({
      data: {
        businessId,
        invoiceNumber: number,
        customerName: "Kund AB",
        issueDate: day(issue),
        grossAmount: gross,
        vatRate: 0.25,
        ...extra
      }
    });
  await invoice("T-1", "2045-12-10", 2500);
  await invoice("T-2", "2045-11-01", 1000, { status: "PAID", paidAt: day("2045-11-20") });
  await invoice("T-3", "2045-12-15", 5000, { status: "PAID", paidAt: day("2046-01-08") });
  await invoice("T-4", "2045-12-20", 560, { vatRate: 0.12 });
  await invoice("T-5", "2045-12-21", 900, { status: "VOID" });
  await invoice("T-6", "2046-01-02", 700);
  const partial = await invoice("T-7", "2045-10-01", 4000, { status: "PARTIAL" });
  await prisma.invoicePayment.create({
    data: { businessId, invoiceId: partial.id, paymentDate: day("2045-10-20"), amount: 1500 }
  });

  const suggestion = await suggestYearEndReceivables(businessId, 2045);
  assert.equal(suggestion.cashMethod, true);
  assert.equal(suggestion.alreadyBooked, false);
  assert.deepEqual(suggestion.totals, { sales25: 2500 + 5000 + 2500, sales12: 560, sales6: 0, sales0: 0 });
  assert.deepEqual(suggestion.invoices.map((row) => row.invoiceNumber).sort(), ["T-1", "T-3", "T-4", "T-7"]);

  await save("year_end_receivables", { year: 2045, ...suggestion.totals, reverse: false });
  assert.equal((await suggestYearEndReceivables(businessId, 2045)).alreadyBooked, true);
});

// ─── Chart of accounts ───────────────────────────────────────────────────────

const rejectsAccount = (promise: Promise<unknown>, code: AccountError["code"]) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccountError, `expected an AccountError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });

test("the BAS number suggests the account type", () => {
  assert.equal(suggestAccountType("1250"), "ASSET");
  assert.equal(suggestAccountType("2018"), "EQUITY");
  assert.equal(suggestAccountType("2350"), "LIABILITY");
  assert.equal(suggestAccountType("2640"), "ASSET");
  assert.equal(suggestAccountType("3010"), "INCOME");
  assert.equal(suggestAccountType("5420"), "EXPENSE");
  assert.equal(suggestAccountType("7832"), "EXPENSE");
  assert.equal(suggestAccountType("8310"), "INCOME");
  assert.equal(suggestAccountType("8410"), "EXPENSE");
  assert.equal(suggestAccountType("9000"), null);
  assert.equal(suggestAccountType("12"), null);
});

test("an account can be added, with validation and a duplicate check", async () => {
  const account = await createAccount({ businessId, code: "5420", name: "  Programvaror   (Software) " });
  assert.equal(account.type, "EXPENSE");
  assert.equal(account.name, "Programvaror (Software)");
  assert.equal(account.isActive, true);
  assert.ok(await prisma.auditLog.findFirst({ where: { businessId, entityId: account.id, action: "CREATE" } }));

  await rejectsAccount(createAccount({ businessId, code: "5420", name: "Again" }), "DUPLICATE");
  await rejectsAccount(createAccount({ businessId, code: "1930", name: "Second bank" }), "DUPLICATE");
  await rejectsAccount(createAccount({ businessId, code: "193", name: "Too short" }), "INVALID_CODE");
  await rejectsAccount(createAccount({ businessId, code: "9100", name: "Outside BAS" }), "INVALID_CODE");
  await rejectsAccount(createAccount({ businessId, code: "5421", name: " " }), "INVALID_NAME");
  await rejectsAccount(createAccount({ businessId, code: "5421", name: "Odd", type: "BANANA" }), "INVALID_TYPE");

  // The same number is free in another business.
  assert.ok(await createAccount({ businessId: otherBusinessId, code: "5420", name: "Programvaror" }));
});

test("an account can be renamed, and deactivated only when nothing depends on it", async () => {
  const id = await accountId("5420");
  const renamed = await updateAccount({ businessId, accountId: id, name: "Programvaror och licenser" });
  assert.equal(renamed.name, "Programvaror och licenser");
  assert.ok(await prisma.auditLog.findFirst({ where: { businessId, entityId: id, action: "RENAME" } }));
  await rejectsAccount(updateAccount({ businessId, accountId: id, name: "" }), "INVALID_NAME");

  // System accounts and accounts the posting templates use stay on.
  await rejectsAccount(updateAccount({ businessId, accountId: await accountId("1930"), isActive: false }), "PROTECTED");
  await rejectsAccount(updateAccount({ businessId, accountId: await accountId("2013"), isActive: false }), "PROTECTED");
  await rejectsAccount(updateAccount({ businessId, accountId: await accountId("2650"), isActive: false }), "PROTECTED");

  // Another business's account cannot be touched.
  await rejectsAccount(updateAccount({ businessId: otherBusinessId, accountId: id, name: "Hijack" }), "NOT_FOUND");

  // An account with entries can be deactivated but is never deleted: it stays in the list and in reports.
  await free([{ code: "5420", debit: 400 }, { code: "1930", credit: 400 }], { txnDate: day("2046-02-01") });
  const off = await updateAccount({ businessId, accountId: id, isActive: false });
  assert.equal(off.isActive, false);

  const list = await listAccountsWithBalances(businessId, 2046);
  const row = list.find((account) => account.code === "5420");
  assert.ok(row, "an inactive account stays in the chart");
  assert.equal(row.isActive, false);
  assert.equal(row.balance, 400);
  assert.equal(row.entryCount, 1);
  const pnl = await buildProfitAndLoss({ businessId, ...yearRange(2046) });
  assert.equal(pnl.expenses, 400);

  const on = await updateAccount({ businessId, accountId: id, isActive: true });
  assert.equal(on.isActive, true);
  assert.ok(await prisma.auditLog.findFirst({ where: { businessId, entityId: id, action: "DEACTIVATE" } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { businessId, entityId: id, action: "REACTIVATE" } }));
});

test("the chart shows the year's balance and an account's entries carry a running balance", async () => {
  const list2041 = await listAccountsWithBalances(businessId, 2041);
  const find = (code: string) => list2041.find((account) => account.code === code);
  assert.equal(find("2013")?.balance, -5000, "withdrawals lower equity");
  assert.equal(find("2018")?.balance, 20000);
  assert.equal(find("6570")?.balance, 124);
  assert.equal(find("1930")?.isProtected, true);

  // Costs start each year at zero; the bank account carries its balance forward.
  const list2042 = await listAccountsWithBalances(businessId, 2042);
  assert.equal(list2042.find((account) => account.code === "6570")?.balance, 0);

  const bank = await getAccountLedger(businessId, await accountId("1930"), 2042);
  assert.ok(bank);
  const closing2041 = list2041.find((account) => account.code === "1930")!.balance;
  assert.equal(bank.opening, closing2041);
  let running = bank.opening;
  for (const row of bank.rows) {
    running = Math.round((running + row.debit - row.credit) * 100) / 100;
    assert.equal(row.balance, running);
  }
  assert.equal(bank.closing, running);
  assert.equal(bank.closing, list2042.find((account) => account.code === "1930")!.balance);

  assert.equal(await getAccountLedger(otherBusinessId, await accountId("1930"), 2042), null);
});
