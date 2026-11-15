/**
 * Integration tests for the guided year-end: the NE-bilaga computation, the
 * SRU export and the year-end overview.
 *
 * Like tests/ledger.test.ts they run against a real PostgreSQL database built
 * from prisma/migrations and refuse to run unless its name ends in "_test".
 * The tests build on each other and run in file order.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/accounting/reports";
import { closeFiscalYear } from "@/lib/accounting/year-end";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { balanceBoxForAccount, buildNeBilaga, neAmount, neBox, resultBoxForAccount } from "@/lib/tax/neBilaga";
import { buildYearEndOverview, saveYearEndInputs } from "@/lib/tax/neYearEnd";
import { buildNeSruFiles, NE_SRU_FIELD_CODES, normalizePersonnummer, sruMissingDetails } from "@/lib/tax/sru";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run year-end tests against "${dbName}". Use a database whose name ends in _test.`);
}

const YEAR = 2026;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const yearRange = (year: number) => ({ from: day(`${year}-01-01`), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) });

// Skatteverket's own example number (640823-3234), from the SRU file transfer page.
const PERSONNUMMER = "640823-3234";
const submitter = { name: "Åsa Öberg", personnummer: PERSONNUMMER, postalCode: "123 45", city: "Skattstad" };

let businessId = "";

const book = (overrides: Partial<Parameters<typeof createCashMethodTransaction>[0]> = {}) =>
  createCashMethodTransaction({
    businessId,
    txnDate: day(`${YEAR}-03-10`),
    description: "Year-end test entry",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 1250,
    vatRate: 0.25,
    source: EntrySources.MANUAL,
    ...overrides
  });

before(async () => {
  const business = await prisma.business.create({
    data: {
      name: "Year-end Test Firma",
      fiscalYearStart: day(`${YEAR}-01-01`),
      taxConfig: { create: {} },
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

  // A small year: two sales, two purchases, interest in and out.
  await book({ direction: TransactionDirections.INCOME, grossAmount: 12500 }); // 3001: 10 000 + 2 500 VAT
  await book({ direction: TransactionDirections.INCOME, grossAmount: 3000, vatRate: 0, incomeAccountCode: "3051" });
  await book({ direction: TransactionDirections.INCOME, grossAmount: 100, vatRate: 0, incomeAccountCode: "8310" });
  await book({ grossAmount: 2500, expenseAccountCode: "4000" }); // 2 000 + 500 VAT
  await book({ grossAmount: 1250, expenseAccountCode: "6110" }); // 1 000 + 250 VAT
  await book({ grossAmount: 40, vatRate: 0, expenseAccountCode: "8410" });
});

after(async () => {
  await prisma.$disconnect();
});

test("accounts map to the boxes of the current NE form", () => {
  assert.equal(balanceBoxForAccount("1930", "ASSET").box, "B9");
  assert.equal(balanceBoxForAccount("1510", "ASSET").box, "B7");
  assert.equal(balanceBoxForAccount("1220", "ASSET").box, "B4");
  assert.equal(balanceBoxForAccount("2010", "EQUITY").box, "B10");
  assert.equal(balanceBoxForAccount("2350", "LIABILITY").box, "B13");
  assert.equal(balanceBoxForAccount("2100", "LIABILITY", "Skulder till kreditinstitut (Bank Loans)").box, "B13");
  assert.equal(balanceBoxForAccount("2440", "LIABILITY").box, "B15");
  assert.equal(balanceBoxForAccount("2610", "LIABILITY").box, "B14");
  assert.equal(balanceBoxForAccount("2900", "LIABILITY").box, "B16");

  assert.equal(resultBoxForAccount("3001", "INCOME").box, "R1");
  assert.equal(resultBoxForAccount("3001", "INCOME", false).box, "R2");
  assert.equal(resultBoxForAccount("3910", "INCOME").box, "R2");
  assert.equal(resultBoxForAccount("8310", "INCOME").box, "R4");
  assert.equal(resultBoxForAccount("4010", "EXPENSE").box, "R5");
  assert.equal(resultBoxForAccount("6570", "EXPENSE").box, "R6");
  assert.equal(resultBoxForAccount("7010", "EXPENSE").box, "R7");
  assert.equal(resultBoxForAccount("8410", "EXPENSE").box, "R8");
  assert.equal(resultBoxForAccount("7840", "EXPENSE").box, "R9");
  assert.equal(resultBoxForAccount("7832", "EXPENSE").box, "R10");
  assert.equal(resultBoxForAccount("X1", "EXPENSE").fallback, true);
});

test("NE boxes for a small year of sales and costs", async () => {
  const ne = await buildNeBilaga(businessId, YEAR, { birthYear: 1964 });

  assert.equal(neAmount(ne, "R1"), 10000);
  assert.equal(neAmount(ne, "R2"), 3000);
  assert.equal(neAmount(ne, "R3"), 0);
  assert.equal(neAmount(ne, "R4"), 100);
  assert.equal(neAmount(ne, "R5"), 2000);
  assert.equal(neAmount(ne, "R6"), 1000);
  assert.equal(neAmount(ne, "R7"), 0);
  assert.equal(neAmount(ne, "R8"), 40);
  assert.equal(neAmount(ne, "R11"), 10060);
  assert.equal(ne.bookedResult, 10060);

  // Balance sheet: bank 12 500 + 3 000 + 100 - 2 500 - 1 250 - 40; VAT owed 2 500 - 750.
  assert.equal(neAmount(ne, "B9"), 11810);
  assert.equal(neAmount(ne, "B14"), 1750);
  assert.equal(neAmount(ne, "B10"), 10060);
  assert.equal(ne.facts.balanceDifference, 0);
  assert.equal(ne.facts.bankBalance, 11810);

  // The accounts behind a box are listed and add up to it.
  const r1 = neBox(ne, "R1");
  assert.deepEqual(r1.accounts.map((line) => [line.code, line.amount]), [["3001", 10000]]);
  const b14 = neBox(ne, "B14");
  assert.equal(b14.accounts.reduce((sum, line) => sum + line.amount, 0), 1750);

  // Tax adjustments with nothing else recorded: 25 % deduction for egenavgifter.
  assert.equal(neAmount(ne, "R12"), 10060);
  assert.equal(neAmount(ne, "R17"), 10060);
  assert.equal(neAmount(ne, "R42"), 10060);
  assert.equal(neAmount(ne, "R43"), 2515);
  assert.equal(neAmount(ne, "R47"), 7545);
  assert.equal(neAmount(ne, "R48"), 0);
  assert.equal(ne.result, 7545);
  assert.equal(ne.facts.egenavgifterRateAssumed, false);

  // What the data cannot answer is listed, not reported as zero.
  assert.equal(neBox(ne, "R40").amount, null);
  assert.ok(ne.fillInYourself.includes("R40"));
  assert.ok(ne.fillInYourself.includes("R13"));
  assert.ok(!ne.fillInYourself.includes("R16"));
});

test("a cancelled entry nets out of every box", async () => {
  const baseline = await buildNeBilaga(businessId, YEAR, { birthYear: 1964 });

  const entry = await book({ grossAmount: 5000, expenseAccountCode: "5410", txnDate: day(`${YEAR}-06-01`) });
  const withEntry = await buildNeBilaga(businessId, YEAR, { birthYear: 1964 });
  assert.equal(neAmount(withEntry, "R6"), neAmount(baseline, "R6") + 4000);

  await prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: entry.id, reason: "Booked by mistake" }));
  const afterVoid = await buildNeBilaga(businessId, YEAR, { birthYear: 1964 });
  assert.deepEqual(
    afterVoid.boxes.map((box) => [box.id, box.amount]),
    baseline.boxes.map((box) => [box.id, box.amount])
  );
  assert.equal(neBox(afterVoid, "R6").accounts.find((line) => line.code === "5410"), undefined);
});

test("the income statement boxes agree with the profit and loss report and the balance sheet", async () => {
  const ne = await buildNeBilaga(businessId, YEAR);
  const pnl = await buildProfitAndLoss({ businessId, ...yearRange(YEAR) });
  const sheet = await buildBalanceSheet({ businessId, ...yearRange(YEAR) });

  const income = ["R1", "R2", "R3", "R4"].reduce((sum, id) => sum + neAmount(ne, id), 0);
  const costs = ["R5", "R6", "R7", "R8", "R9", "R10"].reduce((sum, id) => sum + neAmount(ne, id), 0);
  assert.equal(income, pnl.revenue);
  assert.equal(costs, pnl.expenses);
  assert.equal(neAmount(ne, "R11"), pnl.operatingProfit);

  const assets = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"].reduce((sum, id) => sum + neAmount(ne, id), 0);
  const debts = ["B11", "B12", "B13", "B14", "B15", "B16"].reduce((sum, id) => sum + neAmount(ne, id), 0);
  assert.equal(sheet.difference, 0);
  // The report shows input VAT as an asset; the form nets VAT into one box. Net worth is the same.
  assert.equal(assets - debts, sheet.totalAssets - sheet.totalLiabilities);
  assert.equal(neAmount(ne, "B10"), sheet.totalEquity + sheet.currentYearResult);
});

test("registers and the user's own figures feed the tax adjustments", async () => {
  await prisma.fixedAsset.create({
    data: { businessId, description: "Laptop", acquisitionDate: day(`${YEAR}-02-01`), acquisitionCost: 4000, depreciationMethod: "declining_30" }
  });
  await prisma.mileageEntry.create({
    data: { businessId, tripDate: day(`${YEAR}-04-01`), destination: "Kund", purpose: "Möte", kilometers: 100, ratePerKm: 2.5, deductionAmount: 250 }
  });
  await prisma.periodisationEntry.create({
    data: { businessId, entryType: "periodiseringsfond", direction: "withdrawal", taxYear: YEAR, amount: 1000 }
  });
  await prisma.periodisationEntry.create({
    data: { businessId, entryType: "periodiseringsfond", direction: "allocation", taxYear: YEAR, amount: 50000 }
  });

  const ne = await buildNeBilaga(businessId, YEAR, { birthYear: 1964, manual: { R13: 500, R40: 2000, R41: 1800 } });

  // R16: depreciation 30 % of 4 000 and the mileage allowance, neither booked.
  assert.equal(neAmount(ne, "R16"), 1450);
  assert.deepEqual(neBox(ne, "R16").parts, [
    { key: "depreciation", amount: 1200 },
    { key: "mileage", amount: 250 }
  ]);
  assert.equal(neAmount(ne, "O2"), 250);

  const r17 = 10060 + 500 - 1450;
  assert.equal(neAmount(ne, "R17"), r17);
  assert.equal(neAmount(ne, "R29"), r17);
  assert.equal(neAmount(ne, "R32"), 1000);
  assert.equal(neAmount(ne, "R33"), r17 + 1000);

  // The allocation is capped at 30 % of R33 and the cap is reported.
  const cap = Math.floor((r17 + 1000) * 0.3);
  assert.equal(neAmount(ne, "R34"), cap);
  assert.equal(ne.facts.pfAllocationRequested, 50000);
  assert.ok(ne.warnings.some((warning) => warning.code === "pfCapped"));

  const r42 = r17 + 1000 - cap + 2000 - 1800;
  assert.equal(neAmount(ne, "R42"), r42);
  assert.equal(neAmount(ne, "R43"), Math.floor(r42 * 0.25));
  assert.equal(neAmount(ne, "R47"), r42 - Math.floor(r42 * 0.25));
  assert.equal(neBox(ne, "R13").entered, true);
  assert.ok(!ne.fillInYourself.includes("R40"));

  // Without a year of birth the rate is the standard one and that is said.
  const assumed = await buildNeBilaga(businessId, YEAR);
  assert.equal(assumed.facts.egenavgifterDeductionRate, 0.25);
  assert.ok(assumed.warnings.some((warning) => warning.code === "egenavgifterRateAssumed"));
  // Born 1950: reduced contributions, 10 % deduction.
  const older = await buildNeBilaga(businessId, YEAR, { birthYear: 1950 });
  assert.equal(older.facts.egenavgifterDeductionRate, 0.1);
});

test("person numbers are normalised to twelve digits and checked", () => {
  assert.equal(normalizePersonnummer("640823-3234"), "196408233234");
  assert.equal(normalizePersonnummer("19640823-3234"), "196408233234");
  assert.equal(normalizePersonnummer("196408233234"), "196408233234");
  assert.equal(normalizePersonnummer("640823-3235"), null);
  assert.equal(normalizePersonnummer("123"), null);
  assert.equal(normalizePersonnummer(""), null);
});

test("the SRU files have the structure and values Skatteverket specifies", async () => {
  const ne = await buildNeBilaga(businessId, YEAR, { birthYear: 1964, manual: { R13: 500, R40: 2000, R41: 1800 } });
  const files = buildNeSruFiles({
    ne,
    submitter,
    general: { activity: "Datakonsult #1", helped: "no" },
    createdAt: new Date(Date.UTC(2027, 2, 15, 9, 45, 7))
  });

  // INFO.SRU: fixed record order, CRLF line ends.
  assert.deepEqual(files.infoText.split("\r\n"), [
    "#DATABESKRIVNING_START",
    "#PRODUKT SRU",
    "#SKAPAD 20270315 094507",
    "#PROGRAM Akunta",
    "#FILNAMN BLANKETTER.SRU",
    "#DATABESKRIVNING_SLUT",
    "#MEDIELEV_START",
    "#ORGNR 196408233234",
    "#NAMN Åsa Öberg",
    "#POSTNR 12345",
    "#POSTORT Skattstad",
    "#MEDIELEV_SLUT",
    ""
  ]);

  const lines = files.blanketterText.split("\r\n");
  assert.equal(lines[0], "#BLANKETT NE-2026P4");
  assert.equal(lines[1], "#IDENTITET 196408233234 20270315 094507");
  assert.equal(lines[2], "#NAMN Åsa Öberg");
  assert.deepEqual(lines.slice(-3), ["#BLANKETTSLUT", "#FIL_SLUT", ""]);

  const fields = new Map(
    lines.filter((line) => line.startsWith("#UPPGIFT ")).map((line) => {
      const [, code, ...value] = line.split(" ");
      return [code, value.join(" ")] as const;
    })
  );
  // Every record between the header and the end is an #UPPGIFT with a known code, each at most once.
  assert.equal(fields.size, lines.length - 6);
  const knownCodes = new Set([...Object.values(NE_SRU_FIELD_CODES), "7011", "7012", "7020", "8046", "8047"]);
  for (const code of fields.keys()) assert.ok(knownCodes.has(code), `unexpected field code ${code}`);

  assert.equal(fields.get("7011"), "20260101");
  assert.equal(fields.get("7012"), "20261231");
  assert.equal(fields.get("7020"), "Datakonsult 1"); // "#" is not allowed in strings
  assert.equal(fields.get("8047"), "X");
  assert.equal(fields.has("8046"), false);

  assert.equal(fields.get("7280"), "11810"); // B9
  assert.equal(fields.get("7381"), "1750"); // B14
  assert.equal(fields.get("7300"), "10060"); // B10
  assert.equal(fields.get("7400"), "10000"); // R1
  assert.equal(fields.get("7401"), "3000"); // R2
  assert.equal(fields.get("7403"), "100"); // R4
  assert.equal(fields.get("7500"), "2000"); // R5: a cost, positive because the form prints the minus
  assert.equal(fields.get("7501"), "1000"); // R6
  assert.equal(fields.get("7503"), "40"); // R8
  assert.equal(fields.get("7440"), "10060"); // R11
  assert.equal(fields.get("7600"), "10060"); // R12
  assert.equal(fields.get("7601"), "500"); // R13
  assert.equal(fields.get("7701"), "1450"); // R16
  assert.equal(fields.get("7608"), "1000"); // R32
  assert.equal(fields.get("7709"), String(neAmount(ne, "R34")));
  assert.equal(fields.get("7610"), "2000"); // R40
  assert.equal(fields.get("7713"), "1800"); // R41
  assert.equal(fields.get("7714"), String(neAmount(ne, "R43")));
  assert.equal(fields.get("7630"), String(neAmount(ne, "R47")));
  assert.equal(fields.get("8002"), "250");

  // Empty and zero boxes are left out, and so are the sum boxes that have no field code.
  assert.equal(fields.has("7730"), false); // R48: no deficit
  assert.equal(fields.has("7402"), false); // R3: zero
  assert.equal(fields.has("7705"), false); // R24: not filled in
  for (const value of fields.values()) assert.notEqual(value, "0");

  // ISO 8859-1: one byte per character, also for å and Ö.
  assert.equal(files.info.length, files.infoText.length);
  assert.equal(files.blanketter.length, files.blanketterText.length);
  assert.ok(files.info.includes(Buffer.from("#NAMN \xc5sa \xd6berg", "latin1")));
});

test("no SRU file is produced without field codes for the year or without the sender's details", async () => {
  const future = await buildNeBilaga(businessId, 2031);
  assert.throws(() => buildNeSruFiles({ ne: future, submitter }), /No SRU field codes/);
  assert.deepEqual(sruMissingDetails(2031, submitter), ["unsupportedYear"]);

  const ne = await buildNeBilaga(businessId, YEAR);
  assert.deepEqual(sruMissingDetails(YEAR, { name: " ", personnummer: "640823-0000", postalCode: "12", city: "" }), [
    "name",
    "personnummer",
    "postalCode",
    "city"
  ]);
  assert.throws(() => buildNeSruFiles({ ne, submitter: { ...submitter, postalCode: "" } }), /postalCode/);
});

test("a deficit goes to R48 and gets no deduction for egenavgifter", async () => {
  const loss = await prisma.business.create({
    data: {
      name: "Loss Test Firma",
      fiscalYearStart: day(`${YEAR}-01-01`),
      accounts: {
        create: swedishSoleTraderDefaultAccounts.map((a) => ({ code: a.code, name: a.name, type: a.type, vatCode: a.vatCode }))
      }
    }
  });
  await createCashMethodTransaction({
    businessId: loss.id,
    txnDate: day(`${YEAR}-05-05`),
    description: "Rent",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 800,
    vatRate: 0,
    expenseAccountCode: "5000",
    source: EntrySources.MANUAL
  });
  const ne = await buildNeBilaga(loss.id, YEAR);
  assert.equal(neAmount(ne, "R11"), -800);
  assert.equal(neAmount(ne, "R43"), 0);
  assert.equal(neAmount(ne, "R47"), 0);
  assert.equal(neAmount(ne, "R48"), 800);
  assert.equal(neAmount(ne, "B9"), -800);
  assert.equal(neAmount(ne, "B10"), -800);

  const files = buildNeSruFiles({ ne, submitter });
  assert.ok(files.blanketterText.includes("#UPPGIFT 7730 800\r\n"));
  assert.ok(files.blanketterText.includes("#UPPGIFT 7440 -800\r\n"));
  assert.ok(!files.blanketterText.includes("#UPPGIFT 7630"));
});

test("the overview tracks open steps, saved answers and the closed year", async () => {
  const afterYear = day(`${YEAR + 1}-02-01`);
  const open = await buildYearEndOverview(businessId, YEAR, afterYear);
  assert.equal(open.closed, false);
  assert.equal(open.yearEnded, true);
  assert.equal(open.balance.status, "done");
  assert.equal(open.receipts.status, "done");
  assert.equal(open.bank.status, "attention");
  assert.equal(open.bank.ledgerBalance, 11810);
  assert.equal(open.sru.supported, true);
  assert.equal(open.sru.ready, false);
  assert.ok(open.taxEstimate && open.taxEstimate.total > 0);

  await saveYearEndInputs(businessId, YEAR, {
    bankStatementBalance: 11810,
    manual: { R40: 2000, R41: 1800 },
    confirmed: { supplierBills: true },
    submitter
  });
  await saveYearEndInputs(businessId, YEAR, { manual: { R41: null }, general: { activity: "Datakonsult" } });

  const answered = await buildYearEndOverview(businessId, YEAR, afterYear);
  assert.equal(answered.bank.status, "done");
  assert.equal(answered.supplierBills.status, "done");
  assert.deepEqual(answered.inputs.manual, { R40: 2000 });
  assert.equal(answered.inputs.general.activity, "Datakonsult");
  assert.equal(neBox(answered.ne, "R40").amount, 2000);
  assert.equal(neBox(answered.ne, "R41").amount, null);
  assert.equal(answered.sru.ready, true);
  assert.equal(answered.sru.block, "NE-2026P4");
  assert.equal((await prisma.filing.count({ where: { businessId, filingType: "NE" } })), 1);

  // Closing locks the year and carries the balances forward; the NE-bilaga of the closed year is unchanged.
  const before2026 = answered.ne.boxes.map((box) => [box.id, box.amount]);
  await closeFiscalYear(businessId, YEAR);
  const closed = await buildYearEndOverview(businessId, YEAR, afterYear);
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.ne.boxes.map((box) => [box.id, box.amount]), before2026);

  await book({ txnDate: day(`${YEAR + 1}-01-20`), direction: TransactionDirections.INCOME, grossAmount: 1000, vatRate: 0 });
  const next = await buildNeBilaga(businessId, YEAR + 1);
  assert.equal(neAmount(next, "R1"), 1000);
  assert.equal(neAmount(next, "R11"), 1000);
  assert.equal(neAmount(next, "B9"), 11810 + 1000);
  assert.equal(neAmount(next, "B14"), 1750);
  assert.equal(neAmount(next, "B10"), 10060 + 1000);
  assert.equal(next.facts.balanceDifference, 0);
});
