/**
 * Tests for SIE 4 export and import (lib/sie).
 *
 * Like tests/ledger.test.ts they run against a real PostgreSQL database built
 * from prisma/migrations, so the ledger triggers take part.
 *
 *   npm run test            (see scripts/test.sh)
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/accounting/reports";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { decodeCp437, decodeSieBytes, encodeCp437, toCp437Text } from "@/lib/sie/cp437";
import { buildSieExport } from "@/lib/sie/export";
import { executeSieImport, previewSieImport, SieImportError } from "@/lib/sie/import";
import { parseSie } from "@/lib/sie/parse";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run SIE tests against "${dbName}". Use a database whose name ends in _test.`);
}

const YEAR = 2041;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const yearRange = (year: number) => ({ from: day(`${year}-01-01`), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) });

const COMPANY = 'Åkes Måleri & "Söner"';

let sourceId = "";
let targetId = "";
let exported: Uint8Array = new Uint8Array();

const createBusiness = async (name: string, withChart: boolean) => {
  const business = await prisma.business.create({
    data: {
      name,
      fiscalYearStart: day(`${YEAR}-01-01`),
      personnummer: "19800101-1234",
      accounts: withChart
        ? {
            create: swedishSoleTraderDefaultAccounts.map((a) => ({
              code: a.code,
              name: a.name,
              type: a.type,
              vatCode: a.vatCode,
              isSystem: a.isSystem ?? false
            }))
          }
        : undefined
    }
  });
  return business.id;
};

const counts = async (businessId: string) => ({
  transactions: await prisma.transaction.count({ where: { businessId } }),
  lines: await prisma.journalLine.count({ where: { transaction: { businessId } } }),
  accounts: await prisma.account.count({ where: { businessId } }),
  openingBalances: await prisma.openingBalance.count({ where: { businessId } })
});

/** A small, valid SIE 4 file written by hand, as another program would. */
const handWritten = (options: { company?: string; secondVoucherCredit?: string } = {}) =>
  [
    "#FLAGGA 0",
    '#PROGRAM "Annat Program" 7.2',
    "#FORMAT PC8",
    "#GEN 20420105 AN",
    "#SIETYP 4",
    "#ORGNR 800101-1234",
    `#FNAMN "${options.company ?? "Åsa Öberg Färg"}"`,
    "#RAR 0 20410101 20411231",
    "#KPTYP EUBAS97",
    '#KONTO 1930 "Företagskonto"',
    '#KONTO 2018 "Egna insättningar"',
    '#KONTO 3001 "Försäljning"',
    '#KONTO 6071 "Representation, avdragsgill"',
    '#KONTO 9999 "Används aldrig"',
    "#IB 0 1930 5000.00",
    "#IB 0 2018 -5000.00",
    '#VER A 1 20410110 "Försäljning"',
    "{",
    "   #TRANS 1930 {} 1000.00",
    "   #TRANS 3001 {} -1000.00",
    "}",
    '#VER A 2 20410215 "Lunch med kund" 20410216',
    "{",
    '   #TRANS 6071 {"1" "Nord"} 300.00 20410215 "Lunch"',
    "   #RTRANS 6071 {} 50.00",
    `   #TRANS 1930 {} ${options.secondVoucherCredit ?? "-300.00"}`,
    "}",
    ""
  ].join("\r\n");

before(async () => {
  sourceId = await createBusiness(COMPANY, true);
  targetId = await createBusiness("Target", false);

  // Opening balances, stored with their natural sign: 10 000 in the bank, 10 000 of equity.
  const accounts = await prisma.account.findMany({ where: { businessId: sourceId, code: { in: ["1930", "2010"] } } });
  await prisma.openingBalance.createMany({
    data: accounts.map((account) => ({ businessId: sourceId, accountId: account.id, fiscalYear: YEAR, amount: 10000 }))
  });

  const book = (overrides: Partial<Parameters<typeof createCashMethodTransaction>[0]>) =>
    createCashMethodTransaction({
      businessId: sourceId,
      txnDate: day(`${YEAR}-03-10`),
      description: "Entry",
      direction: TransactionDirections.EXPENSE,
      grossAmount: 1250,
      vatRate: 0.25,
      source: EntrySources.MANUAL,
      ...overrides
    });

  await book({ direction: TransactionDirections.INCOME, grossAmount: 12500, description: 'Försäljning "Blå" åäö ÅÄÖ' });
  await book({ grossAmount: 625.5, txnDate: day(`${YEAR}-04-02`), description: "Färg och penslar" });
  const mistake = await book({ grossAmount: 999, txnDate: day(`${YEAR}-05-20`), description: "Bokfört två gånger" });
  await prisma.$transaction((tx) =>
    voidTransaction(tx, { businessId: sourceId, transactionId: mistake.id, reason: "Booked twice" })
  );
  // A verification in another year must stay out of the file.
  await book({ txnDate: day(`${YEAR + 1}-01-05`), description: "Nästa år" });

  exported = (await buildSieExport(prisma, { businessId: sourceId, year: YEAR })).bytes;
});

after(async () => {
  await prisma.$disconnect();
});

test("codepage 437 encodes and decodes Swedish letters", () => {
  const bytes = encodeCp437("å ä ö Å Ä Ö é ü");
  assert.deepEqual([...bytes], [0x86, 0x20, 0x84, 0x20, 0x94, 0x20, 0x8f, 0x20, 0x8e, 0x20, 0x99, 0x20, 0x82, 0x20, 0x81]);
  assert.equal(decodeCp437(bytes), "å ä ö Å Ä Ö é ü");

  // Characters the codepage lacks are written with what it has, never as raw UTF-8.
  assert.equal(decodeCp437(encodeCp437("São Paulo – “café” €5")), 'Sao Paulo - "café" EUR5');
  assert.ok(encodeCp437("漢").every((byte) => byte === 0x3f));
});

test("the export is a codepage 437 SIE 4 file", () => {
  // "Måleri" must be M, 0x86, l ... and the file must not be valid UTF-8 with multi-byte characters.
  const needle = [0x4d, 0x86, 0x6c, 0x65, 0x72, 0x69];
  const found = exported.some((_, i) => needle.every((byte, j) => exported[i + j] === byte));
  assert.ok(found, "å must be written as byte 0x86");
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(exported));

  const { text, encoding } = decodeSieBytes(exported);
  assert.equal(encoding, "cp437");
  const lines = text.split("\r\n");
  assert.equal(lines[0], "#FLAGGA 0");
  assert.ok(lines.includes("#FORMAT PC8"));
  assert.ok(lines.includes("#SIETYP 4"));
  assert.ok(lines.includes("#ORGNR 800101-1234"));
  assert.ok(lines.includes(`#RAR 0 ${YEAR}0101 ${YEAR}1231`));
  assert.ok(lines.includes("#VALUTA SEK"));
});

test("export then parse preserves accounts, balances and verifications", async () => {
  const doc = parseSie(decodeSieBytes(exported).text);
  assert.deepEqual(doc.issues, []);
  assert.equal(doc.sieType, 4);
  assert.equal(doc.companyName, COMPANY);

  // Accounts: every account, with its name and a type that maps back.
  const accounts = await prisma.account.findMany({ where: { businessId: sourceId } });
  assert.equal(doc.accounts.size, accounts.length);
  for (const account of accounts) {
    const parsed = doc.accounts.get(account.code);
    // Codepage 437 has no en dash, so one default account name comes back with a hyphen.
    assert.equal(parsed?.name, toCp437Text(account.name));
    assert.ok(parsed?.type, `account ${account.code} must carry #KTYP`);
  }
  assert.equal(doc.accounts.get("1930")?.type, "T");
  assert.equal(doc.accounts.get("2010")?.type, "S");
  assert.equal(doc.accounts.get("3001")?.type, "I");
  assert.equal(doc.accounts.get("4000")?.type, "K");

  // Opening balances: debit-positive in the file, and they sum to zero.
  const opening = new Map(doc.openingBalances.filter((r) => r.yearIndex === 0).map((r) => [r.account, r.amountOre]));
  assert.equal(opening.get("1930"), 1_000_000);
  assert.equal(opening.get("2010"), -1_000_000);
  assert.equal([...opening.values()].reduce((a, b) => a + b, 0), 0);

  // Verifications: all four of the year, the cancelled one and its correction included.
  const transactions = await prisma.transaction.findMany({
    where: { businessId: sourceId, txnDate: { gte: yearRange(YEAR).from, lte: yearRange(YEAR).to } },
    include: { lines: { include: { account: true } } },
    orderBy: { verificationNumber: "asc" }
  });
  assert.equal(transactions.length, 4);
  assert.ok(transactions.some((t) => t.voidedAt !== null), "the cancelled verification is exported");
  assert.ok(transactions.some((t) => t.reversesTransactionId !== null), "its correction is exported");
  assert.equal(doc.vouchers.length, transactions.length);

  for (const [i, transaction] of transactions.entries()) {
    const voucher = doc.vouchers[i];
    assert.equal(voucher.series, "A");
    assert.equal(voucher.number, String(transaction.verificationNumber));
    assert.equal(voucher.date, transaction.txnDate.toISOString().slice(0, 10).replace(/-/g, ""));
    assert.equal(voucher.text, transaction.description);
    assert.equal(voucher.lines.reduce((sum, line) => sum + line.amountOre, 0), 0, "every verification balances");

    const expected = transaction.lines
      .map((line) => `${line.account.code}:${Math.round((Number(line.debit) - Number(line.credit)) * 100)}`)
      .sort();
    assert.deepEqual(voucher.lines.map((line) => `${line.account}:${line.amountOre}`).sort(), expected);
  }

  // Closing balances and results agree with Akunta's own reports.
  const sheet = await buildBalanceSheet({ businessId: sourceId, ...yearRange(YEAR) });
  const pnl = await buildProfitAndLoss({ businessId: sourceId, ...yearRange(YEAR) });
  const closing = new Map(doc.closingBalances.filter((r) => r.yearIndex === 0).map((r) => [r.account, r.amountOre]));
  const bank = sheet.assets.find((a) => a.accountCode === "1930");
  assert.equal(closing.get("1930"), Math.round((bank?.amount ?? 0) * 100));
  const results = doc.results.filter((r) => r.yearIndex === 0);
  // Results are debit-positive, so a profit is negative.
  assert.equal(results.reduce((sum, r) => sum + r.amountOre, 0), -Math.round(pnl.operatingProfit * 100));
  // Closing balances plus results sum to zero: the file is internally consistent.
  assert.equal([...closing.values()].reduce((a, b) => a + b, 0) + results.reduce((sum, r) => sum + r.amountOre, 0), 0);
});

test("the preview says what will happen and writes nothing", async () => {
  const before = await counts(targetId);
  const preview = await previewSieImport(prisma, { businessId: targetId, bytes: exported });

  assert.deepEqual(preview.errors, []);
  assert.equal(preview.canImport, true);
  assert.equal(preview.companyName, COMPANY);
  assert.deepEqual(preview.fiscalYears[0], { index: 0, start: `${YEAR}-01-01`, end: `${YEAR}-12-31` });
  assert.equal(preview.vouchersInFile, 4);
  assert.equal(preview.vouchersToImport, 4);
  assert.equal(preview.allBalanced, true);
  assert.equal(preview.openingBalancesToImport, 2);
  assert.deepEqual(preview.closingCheck?.mismatches, 0);
  // The target has no accounts, so every account the file uses is created, and only those.
  const toCreate = new Map(preview.accountsToCreate.map((a) => [a.code, a.type]));
  assert.equal(toCreate.get("1930"), "ASSET");
  assert.equal(toCreate.get("2010"), "EQUITY");
  assert.equal(toCreate.get("2610"), "LIABILITY");
  assert.equal(toCreate.get("3001"), "INCOME");
  assert.ok(!toCreate.has("7010"), "unused accounts are not created");
  assert.ok(preview.skipped.some((message) => /never used/.test(message)));

  assert.deepEqual(await counts(targetId), before);
});

test("import books the file so that the reports match the source", async () => {
  const result = await executeSieImport(prisma, { businessId: targetId, bytes: exported, fileName: "source.se" });
  assert.equal(result.vouchersImported, 4);
  assert.equal(result.firstVerificationNumber, 1);
  assert.equal(result.lastVerificationNumber, 4);
  assert.equal(result.openingBalancesImported, 2);

  const imported = await prisma.transaction.findMany({
    where: { businessId: targetId },
    include: { lines: true },
    orderBy: { verificationNumber: "asc" }
  });
  assert.deepEqual(imported.map((t) => t.verificationNumber), [1, 2, 3, 4]);
  for (const transaction of imported) {
    assert.equal(transaction.source, EntrySources.SIE_IMPORT);
    assert.equal(transaction.direction, TransactionDirections.TRANSFER);
    assert.equal(Number(transaction.vatAmount), 0);
    assert.match(transaction.reference ?? "", /^SIE:A:\d+:\d{8}$/);
    const debit = transaction.lines.reduce((sum, line) => sum + Number(line.debit), 0);
    assert.equal(Number(transaction.grossAmount), debit);
  }

  const range = yearRange(YEAR);
  const [sourcePnl, targetPnl] = await Promise.all([
    buildProfitAndLoss({ businessId: sourceId, ...range }),
    buildProfitAndLoss({ businessId: targetId, ...range })
  ]);
  assert.equal(targetPnl.revenue, sourcePnl.revenue);
  assert.equal(targetPnl.expenses, sourcePnl.expenses);

  const [sourceSheet, targetSheet] = await Promise.all([
    buildBalanceSheet({ businessId: sourceId, ...range }),
    buildBalanceSheet({ businessId: targetId, ...range })
  ]);
  assert.equal(targetSheet.difference, 0);
  const amounts = (items: Array<{ accountCode: string; amount: number }>) => items.map((i) => `${i.accountCode}:${i.amount}`);
  assert.deepEqual(amounts(targetSheet.assets), amounts(sourceSheet.assets));
  assert.deepEqual(amounts(targetSheet.liabilities), amounts(sourceSheet.liabilities));
  assert.deepEqual(amounts(targetSheet.equity), amounts(sourceSheet.equity));

  const audit = await prisma.auditLog.findFirst({ where: { businessId: targetId, entityType: "SieImport", action: "IMPORT" } });
  assert.ok(audit, "the import must write an audit row");
});

test("a second import of the same file is refused", async () => {
  const before = await counts(targetId);

  await assert.rejects(
    executeSieImport(prisma, { businessId: targetId, bytes: exported }),
    (error: unknown) => {
      assert.ok(error instanceof SieImportError);
      assert.match(error.message, /already imported on \d{4}-\d{2}-\d{2}/);
      return true;
    }
  );

  // The same books exported again on another day are still the same books.
  const again = (await buildSieExport(prisma, { businessId: sourceId, year: YEAR, now: day("2050-06-01") })).bytes;
  assert.notDeepEqual([...again], [...exported]);
  const preview = await previewSieImport(prisma, { businessId: targetId, bytes: again });
  assert.equal(preview.canImport, false);
  assert.match(preview.errors[0], /already imported/);

  assert.deepEqual(await counts(targetId), before);
});

test("an unbalanced verification is rejected with a clear message and nothing is written", async () => {
  const businessId = await createBusiness("Unbalanced", true);
  const before = await counts(businessId);
  const bytes = encodeCp437(handWritten({ secondVoucherCredit: "-250.00" }));

  const preview = await previewSieImport(prisma, { businessId, bytes });
  assert.equal(preview.canImport, false);
  assert.equal(preview.allBalanced, false);
  assert.equal(preview.errors.length, 1);
  assert.match(
    preview.errors[0],
    /^Line 22: verification A 2 dated 2041-02-15 does not balance\. Debit is 300\.00 and credit is 250\.00, a difference of 50\.00\./
  );

  await assert.rejects(executeSieImport(prisma, { businessId, bytes }), SieImportError);
  assert.deepEqual(await counts(businessId), before, "the balanced verification must not be written either");
});

test("an import into a locked period fails before anything is written", async () => {
  const businessId = await createBusiness("Locked", true);
  await prisma.periodLock.create({
    data: { businessId, periodStart: day(`${YEAR}-01-01`), periodEnd: new Date(Date.UTC(YEAR, 11, 31, 23, 59, 59, 999)) }
  });
  const before = await counts(businessId);
  const bytes = encodeCp437(handWritten());

  await assert.rejects(
    executeSieImport(prisma, { businessId, bytes }),
    (error: unknown) => {
      assert.ok(error instanceof SieImportError);
      assert.match(error.message, /2 of the verifications are dated in a period that is locked in Akunta \(2041-01-01 to 2041-12-31\)/);
      return true;
    }
  );
  assert.deepEqual(await counts(businessId), before);
});

test("files in codepage 437, Latin-1 and UTF-8 are all read, and other programs' quirks are tolerated", async () => {
  const text = handWritten();
  const variants: Array<[string, Uint8Array]> = [
    ["cp437", encodeCp437(text)],
    ["latin1", Uint8Array.from(Buffer.from(text, "latin1"))],
    ["utf8", Uint8Array.from(Buffer.from(`\ufeff${text}`, "utf8"))]
  ];
  for (const [expected, bytes] of variants) {
    const decoded = decodeSieBytes(bytes);
    assert.equal(decoded.encoding, expected);
    const doc = parseSie(decoded.text);
    assert.deepEqual(doc.issues, [], expected);
    assert.equal(doc.companyName, "Åsa Öberg Färg", expected);
    assert.equal(doc.accounts.get("1930")?.name, "Företagskonto", expected);
  }

  const businessId = await createBusiness("Quirks", true);
  const result = await executeSieImport(prisma, { businessId, bytes: variants[1][1] });
  assert.equal(result.vouchersImported, 2);
  // 6071 is not in Akunta's default chart; 9999 is never used.
  assert.deepEqual(result.preview.accountsToCreate.map((a) => `${a.code}:${a.type}`), ["6071:EXPENSE"]);
  assert.ok(result.preview.skipped.some((message) => /Cost centres/.test(message)));

  // #RTRANS is ignored and the object list does not disturb the amount.
  const lunch = await prisma.transaction.findFirstOrThrow({
    where: { businessId, reference: "SIE:A:2:20410215" },
    include: { lines: { include: { account: true } } }
  });
  assert.equal(lunch.description, "Lunch med kund");
  assert.deepEqual(
    lunch.lines.map((l) => `${l.account.code}:${Number(l.debit)}:${Number(l.credit)}`).sort(),
    ["1930:0:300", "6071:300:0"]
  );

  // Opening balances are stored with Akunta's natural sign: equity of 5 000 is +5 000.
  const opening = await prisma.openingBalance.findMany({ where: { businessId }, include: { account: true } });
  assert.deepEqual(opening.map((o) => `${o.account.code}:${Number(o.amount)}`).sort(), ["1930:5000", "2018:5000"]);

  // A later file that repeats A 1 and A 2 and adds A 3 only brings in A 3.
  const longer = text.replace(/\r\n$/, "") + ['', '#VER A 3 20410301 "Bankavgift"', "{", "   #TRANS 6570 {} 45.00", "   #TRANS 1930 {} -45.00", "}", ""].join("\r\n");
  const second = await previewSieImport(prisma, { businessId, bytes: encodeCp437(longer) });
  assert.equal(second.canImport, true);
  assert.equal(second.vouchersToImport, 1);
  assert.ok(second.skipped.some((message) => /2 verifications were imported from an earlier file/.test(message)));
});
