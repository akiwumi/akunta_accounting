/**
 * Tests for the VAT return (momsdeklaration): boxes, periods and deadlines,
 * the cross-check against the ledger, the file for Skatteverket and the
 * record of a filed return.
 *
 * Runs against a real PostgreSQL database built from prisma/migrations (see
 * scripts/test.sh). Safety: refuses to run unless the database name ends in
 * "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { LedgerError, voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import {
  buildEskdXml,
  buildMomsdeklaration,
  classifyVatRate,
  encodeEskdXml,
  filedBoxes,
  findMomsFiling,
  MomsFilingError,
  normalizeOrgNr,
  recordMomsFiling,
  toWholeKronor,
  vatActiveFrom
} from "@/lib/tax/momsdeklaration";
import {
  findVatPeriod,
  generateVatPeriods,
  isSwedishNonWorkingDay,
  listVatPeriods,
  pickDefaultVatPeriod,
  vatPeriodStatus,
  type VatPeriodOptions
} from "@/lib/tax/vat-periods";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run VAT tests against "${dbName}". Use a database whose name ends in _test.`);
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
/** A calendar month of 2041 as a period. Each test uses its own month. */
const month = (m: number) => ({
  from: new Date(Date.UTC(2041, m - 1, 1)),
  to: new Date(Date.UTC(2041, m, 0, 23, 59, 59, 999))
});
const inMonth = (m: number, d = 10) => new Date(Date.UTC(2041, m - 1, d));

let businessId = "";

const book = (overrides: Partial<Parameters<typeof createCashMethodTransaction>[0]> = {}) =>
  createCashMethodTransaction({
    businessId,
    txnDate: inMonth(1),
    description: "VAT test entry",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 1250,
    vatRate: 0.25,
    source: EntrySources.MANUAL,
    ...overrides
  });

const sale = (m: number, grossAmount: number, vatRate: number, incomeAccountCode = "3001") =>
  book({ txnDate: inMonth(m), direction: TransactionDirections.INCOME, grossAmount, vatRate, incomeAccountCode });

const purchase = (m: number, grossAmount: number, vatRate: number) =>
  book({ txnDate: inMonth(m), direction: TransactionDirections.EXPENSE, grossAmount, vatRate });

/** Minimal well-formedness check: one root, every tag closed in order, no stray text. */
const parseSimpleXml = (xml: string) => {
  const declaration = /^<\?xml version="1\.0" encoding="([^"]+)"\?>\n/.exec(xml);
  assert.ok(declaration, "the file must start with an XML declaration");
  const body = xml.slice(declaration[0].length);
  const stack: string[] = [];
  const values: Array<{ path: string; value: string }> = [];
  const token = /<(\/?)([A-Za-z0-9]+)((?:\s+[A-Za-z]+="[^"<]*")*)>|([^<]+)/g;
  let consumed = 0;
  let roots = 0;
  let text = "";
  for (let match = token.exec(body); match; match = token.exec(body)) {
    assert.equal(match.index, consumed, `unexpected characters at offset ${consumed}`);
    consumed = token.lastIndex;
    const [, closing, name, , chars] = match;
    if (chars !== undefined) {
      text = chars;
    } else if (closing) {
      assert.equal(stack.pop(), name, `</${name}> closes the wrong element`);
      if (text.trim()) values.push({ path: [...stack, name].join("/"), value: text });
      text = "";
    } else {
      assert.equal(text.trim(), "", "text between elements");
      if (stack.length === 0) roots += 1;
      stack.push(name);
      text = "";
    }
  }
  assert.equal(consumed, body.length, "trailing characters that are not XML");
  assert.equal(stack.length, 0, "unclosed elements");
  assert.equal(roots, 1, "exactly one root element");
  return { encoding: declaration[1], values };
};

before(async () => {
  const business = await prisma.business.create({
    data: {
      name: "VAT Test Firma",
      fiscalYearStart: day("2041-01-01"),
      vatFrequency: "monthly",
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

// ─── Boxes ───────────────────────────────────────────────────────────────────

test("mixed 25/12/6 % sales and purchases land in the right boxes", async () => {
  await sale(1, 1250, 0.25); // net 1000, VAT 250
  await sale(1, 1120, 0.12, "3041"); // net 1000, VAT 120
  await sale(1, 530, 0.06, "3046"); // net 500, VAT 30
  await purchase(1, 625, 0.25); // VAT 125
  await purchase(1, 112, 0.12); // VAT 12
  // Not part of the return: a sale without VAT and an entry in another month.
  await sale(1, 400, 0, "3051");
  await sale(2, 9999, 0.25);

  const result = await buildMomsdeklaration({ businessId, ...month(1) });

  assert.deepEqual(result.boxes, { "05": 2500, "10": 250, "11": 120, "12": 30, "48": 137, "49": 263 });
  assert.equal(result.boxes["49"], result.boxes["10"] + result.boxes["11"] + result.boxes["12"] - result.boxes["48"]);
  assert.equal(result.entries["05"].length, 3);
  assert.equal(result.entries["10"].length, 1);
  assert.equal(result.entries["11"].length, 1);
  assert.equal(result.entries["12"].length, 1);
  assert.equal(result.entries["48"].length, 2);
  assert.deepEqual(result.salesWithoutVat, { amount: 400, count: 1 });

  // The ledger's VAT accounts agree with the boxes.
  assert.equal(result.crossCheck.ok, true);
  assert.equal(result.crossCheck.ledgerOutputVat, 400);
  assert.equal(result.crossCheck.ledgerInputVat, 137);
  assert.deepEqual(result.blockers, []);
});

test("a cancelled entry and its correction net out of every box", async () => {
  const period = month(3);
  await sale(3, 2500, 0.25);
  await purchase(3, 500, 0.25);
  const baseline = await buildMomsdeklaration({ businessId, ...period });
  assert.deepEqual(baseline.boxes, { "05": 2000, "10": 500, "11": 0, "12": 0, "48": 100, "49": 400 });

  const wrongSale = await sale(3, 1120, 0.12, "3041");
  const wrongPurchase = await purchase(3, 1250, 0.25);
  const withMistakes = await buildMomsdeklaration({ businessId, ...period });
  assert.deepEqual(withMistakes.boxes, { "05": 3000, "10": 500, "11": 120, "12": 0, "48": 350, "49": 270 });

  await prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: wrongSale.id, reason: "Wrong customer" }));
  await prisma.$transaction((tx) => voidTransaction(tx, { businessId, transactionId: wrongPurchase.id, reason: "Booked twice" }));

  const corrected = await buildMomsdeklaration({ businessId, ...period });
  assert.deepEqual(corrected.boxes, baseline.boxes);
  assert.deepEqual(corrected.exact, baseline.exact);
  assert.equal(corrected.crossCheck.ok, true);

  // Both halves of each pair stay visible behind the box, flagged.
  const behind11 = corrected.entries["11"];
  assert.equal(behind11.length, 2);
  assert.ok(behind11.some((e) => e.cancelled && e.vat === 120));
  assert.ok(behind11.some((e) => e.correction && e.vat === -120));
  assert.equal(corrected.entries["48"].filter((e) => e.cancelled || e.correction).length, 2);
});

test("boxes drop the öre and box 49 is the sum of the whole-krona boxes", async () => {
  await sale(4, 123.45, 0.25); // net 98.76, VAT 24.69
  await sale(4, 99.99, 0.12, "3041"); // net 89.28, VAT 10.71
  await sale(4, 10.55, 0.06, "3046"); // net 9.95, VAT 0.60
  await purchase(4, 55.55, 0.25); // VAT 11.11

  const result = await buildMomsdeklaration({ businessId, ...month(4) });

  assert.deepEqual(result.exact, { "05": 197.99, "10": 24.69, "11": 10.71, "12": 0.6, "48": 11.11, "49": 24.89 });
  assert.deepEqual(result.boxes, { "05": 197, "10": 24, "11": 10, "12": 0, "48": 11, "49": 23 });
  for (const value of Object.values(result.boxes)) assert.ok(Number.isInteger(value));
  assert.equal(result.boxes["49"], result.boxes["10"] + result.boxes["11"] + result.boxes["12"] - result.boxes["48"]);

  assert.equal(toWholeKronor(13.99), 13);
  assert.equal(toWholeKronor(-13.99), -13);
  assert.ok(Object.is(toWholeKronor(-0.4), 0), "minus zero must not reach the form");
});

test("more input than output VAT gives a negative box 49 (a refund)", async () => {
  await sale(5, 1250, 0.25);
  await purchase(5, 5000, 0.25);
  const result = await buildMomsdeklaration({ businessId, ...month(5) });
  assert.deepEqual(result.boxes, { "05": 1000, "10": 250, "11": 0, "12": 0, "48": 1000, "49": -750 });
});

test("the VAT rate is read from the amounts, and from the stored rate only without them", () => {
  assert.equal(classifyVatRate(0.25, 1000, 250), 25);
  assert.equal(classifyVatRate(0.12, 1000, 120), 12);
  assert.equal(classifyVatRate(0.06, 500, 30), 6);
  assert.equal(classifyVatRate(25, 1000, 250), 25, "a rate stored as a percentage");
  assert.equal(classifyVatRate(0, 1000, 250), 25, "no stored rate");
  assert.equal(classifyVatRate(0.2501, 3.96, 0.99), 25, "a rate computed from rounded amounts");
  assert.equal(classifyVatRate(0.25, -1000, -250), 25, "a correcting entry");
  assert.equal(classifyVatRate(0.185, 1000, 185), null, "a mix of rates in one entry");
  assert.equal(classifyVatRate(0.25, 1000, 185), null, "a stored rate the amounts contradict");
  assert.equal(classifyVatRate(0.12, 0, 0), 12, "nothing to compare with: the stored rate decides");
});

// ─── Checks ──────────────────────────────────────────────────────────────────

test("what blocks a correct return is listed, and the ledger difference is shown", async () => {
  const period = month(6);
  await sale(6, 1250, 0.25);

  // A sale that mixes 25 % and 12 % in one entry: the rate cannot be told.
  const mixed = await book({
    txnDate: inMonth(6),
    direction: TransactionDirections.INCOME,
    grossAmount: 1185,
    netAmount: 1000,
    vatAmount: 185
  });

  // Receipts are only booked once reviewed.
  const waiting = await prisma.receipt.create({
    data: {
      businessId,
      originalFileName: "waiting.pdf",
      mimeType: "application/pdf",
      filePath: "test/waiting.pdf",
      vendor: "Byggmax",
      receiptDate: inMonth(6, 20),
      grossAmount: 500,
      needsReview: true
    }
  });
  await prisma.receipt.create({
    data: {
      businessId,
      originalFileName: "other-month.pdf",
      mimeType: "application/pdf",
      filePath: "test/other-month.pdf",
      receiptDate: inMonth(7, 2),
      needsReview: true
    }
  });
  await prisma.receipt.create({
    data: {
      businessId,
      originalFileName: "reviewed.pdf",
      mimeType: "application/pdf",
      filePath: "test/reviewed.pdf",
      receiptDate: inMonth(6, 21),
      needsReview: false
    }
  });

  const result = await buildMomsdeklaration({ businessId, ...period });

  // The unclear entry is in no box, so the boxes are short of the ledger by its VAT.
  assert.deepEqual(result.boxes, { "05": 1000, "10": 250, "11": 0, "12": 0, "48": 0, "49": 250 });
  assert.equal(result.crossCheck.ok, false);
  assert.equal(result.crossCheck.ledgerOutputVat, 435);
  assert.equal(result.crossCheck.outputDifference, -185);
  assert.equal(result.crossCheck.inputDifference, 0);

  const byId = new Map(result.blockers.map((b) => [b.id, b]));
  const receipts = byId.get("receiptsPending");
  assert.equal(receipts?.count, 1);
  assert.equal(receipts?.items[0].href, `/review/receipts/${waiting.id}`);

  const unclear = byId.get("unclearRate");
  assert.equal(unclear?.count, 1);
  assert.equal(unclear?.amount, 185);
  assert.equal(unclear?.items[0].href, `/review/transactions/${mixed.id}`);

  assert.ok(byId.has("ledgerMismatch"));
});

test("a sale booked on a 25 % sales account without VAT is flagged", async () => {
  await sale(7, 800, 0, "3001");
  const result = await buildMomsdeklaration({ businessId, ...month(7) });
  const flagged = result.blockers.find((b) => b.id === "salesAccountWithoutVat");
  assert.equal(flagged?.severity, "warning");
  assert.equal(flagged?.count, 1);
  assert.equal(result.boxes["05"], 0);
});

// ─── Periods and deadlines ───────────────────────────────────────────────────

const soleTrader = (frequency: VatPeriodOptions["frequency"], fiscalYearStartMonth = 1): VatPeriodOptions => ({
  frequency,
  fiscalYearStartMonth,
  orgType: "sole_trader"
});

test("monthly periods: the 12th of the second month after, the 17th in January and August", () => {
  const periods = generateVatPeriods(2026, soleTrader("monthly"));
  assert.equal(periods.length, 12);
  assert.equal(periods[0].key, "2026-01-01_2026-01-31");
  assert.equal(periods[1].key, "2026-02-01_2026-02-28");
  assert.equal(periods[11].key, "2026-12-01_2026-12-31");
  assert.equal(periods[0].skvPeriod, "202601");
  assert.equal(periods[0].end.toISOString(), "2026-01-31T23:59:59.999Z");

  const deadline = (index: number) => iso(periods[index].deadline);
  assert.equal(deadline(0), "2026-03-12"); // January
  assert.equal(deadline(3), "2026-06-12"); // April
  assert.equal(deadline(5), "2026-08-17"); // June: the 17th in August
  assert.equal(periods[5].deadlineRule, "monthly17");
  assert.equal(deadline(11), "2027-02-12"); // December

  // February: 12 April 2026 is a Sunday, so the deadline moves to Monday.
  assert.equal(deadline(1), "2026-04-13");
  assert.equal(periods[1].deadlineMoved, true);
  // November: 17 January 2027 is a Sunday.
  assert.equal(deadline(10), "2027-01-18");

  // Turnover above SEK 40 million: the 26th of the month after, the 27th in December.
  const large = generateVatPeriods(2026, { ...soleTrader("monthly"), largeTurnover: true });
  assert.equal(iso(large[0].deadline), "2026-02-26");
  assert.equal(iso(large[10].deadline), "2026-12-28"); // 27 December 2026 is a Sunday
});

test("quarterly periods follow calendar quarters: the 12th of the second month after, the 17th in August", () => {
  const periods = generateVatPeriods(2026, soleTrader("quarterly"));
  assert.deepEqual(
    periods.map((p) => [p.key, p.skvPeriod, iso(p.deadline)]),
    [
      ["2026-01-01_2026-03-31", "202603", "2026-05-12"],
      ["2026-04-01_2026-06-30", "202606", "2026-08-17"],
      ["2026-07-01_2026-09-30", "202609", "2026-11-12"],
      ["2026-10-01_2026-12-31", "202612", "2027-02-12"]
    ]
  );

  // A fiscal year from July still reports calendar quarters.
  const broken = generateVatPeriods(2026, soleTrader("quarterly", 7));
  assert.deepEqual(
    broken.map((p) => p.key),
    ["2026-07-01_2026-09-30", "2026-10-01_2026-12-31", "2027-01-01_2027-03-31", "2027-04-01_2027-06-30"]
  );
});

test("yearly periods: 12 May for a sole trader, 26 February with EU trade", () => {
  const [period] = generateVatPeriods(2026, soleTrader("yearly"));
  assert.equal(period.key, "2026-01-01_2026-12-31");
  assert.equal(period.skvPeriod, "202612");
  assert.equal(iso(period.deadline), "2027-05-12");
  assert.equal(period.deadlineRule, "yearlySoleTrader");
  assert.equal(iso(period.euTradeDeadline!), "2027-02-26");

  const [withEu] = generateVatPeriods(2026, { ...soleTrader("yearly"), euTrade: true });
  assert.equal(iso(withEu.deadline), "2027-02-26");
  assert.equal(withEu.euTradeDeadline, null);

  // 12 May 2029 is a Saturday.
  const [weekend] = generateVatPeriods(2028, soleTrader("yearly"));
  assert.equal(iso(weekend.deadline), "2029-05-14");

  // A company with a fiscal year ending in June files with its income tax return.
  const [company] = generateVatPeriods(2026, { frequency: "yearly", fiscalYearStartMonth: 7, orgType: "limited_company" });
  assert.equal(company.key, "2026-07-01_2027-06-30");
  assert.equal(company.skvPeriod, "202706");
  assert.equal(iso(company.deadline), "2028-01-17");
});

test("deadlines never fall on Swedish non-working days", () => {
  assert.equal(isSwedishNonWorkingDay(day("2026-04-03")), true, "Good Friday");
  assert.equal(isSwedishNonWorkingDay(day("2026-04-06")), true, "Easter Monday");
  assert.equal(isSwedishNonWorkingDay(day("2026-05-14")), true, "Ascension Day");
  assert.equal(isSwedishNonWorkingDay(day("2026-06-19")), true, "Midsummer Eve");
  assert.equal(isSwedishNonWorkingDay(day("2026-12-24")), true, "Christmas Eve");
  assert.equal(isSwedishNonWorkingDay(day("2026-05-12")), false);
});

test("a period is upcoming, ready, overdue or filed", () => {
  const [q1] = generateVatPeriods(2026, soleTrader("quarterly"));
  assert.equal(vatPeriodStatus(q1, { filed: false, today: "2026-03-31" }), "upcoming");
  assert.equal(vatPeriodStatus(q1, { filed: false, today: "2026-04-01" }), "ready");
  assert.equal(vatPeriodStatus(q1, { filed: false, today: "2026-05-12" }), "ready");
  assert.equal(vatPeriodStatus(q1, { filed: false, today: "2026-05-13" }), "overdue");
  assert.equal(vatPeriodStatus(q1, { filed: true, today: "2026-05-13" }), "filed");
});

test("a period key from a URL resolves only to a real reporting period", () => {
  const options = soleTrader("quarterly");
  assert.equal(findVatPeriod("2026-04-01_2026-06-30", options)?.skvPeriod, "202606");
  assert.equal(findVatPeriod("2026-04-01_2026-05-31", options), null);
  assert.equal(findVatPeriod("2026-04-01_2026-04-30", options), null, "a month is not a period for a quarterly filer");
  assert.equal(findVatPeriod("nonsense", options), null);
  assert.equal(findVatPeriod(null, options), null);
});

test("periods that ended before the business had any activity are not listed", async () => {
  const options = soleTrader("yearly");
  const now = day("2026-11-15");

  // Without a start date both fiscal years are listed, and 2025 would read as overdue.
  assert.deepEqual(listVatPeriods(options, now).map((p) => p.skvPeriod), ["202512", "202612"]);

  // A business whose first fiscal year starts 2026-01-01 has nothing to file for 2025.
  assert.deepEqual(listVatPeriods(options, now, day("2026-01-01")).map((p) => p.skvPeriod), ["202612"]);
  // History from before the fiscal year start (an import) brings the period back.
  assert.deepEqual(listVatPeriods(options, now, day("2025-09-03")).map((p) => p.skvPeriod), ["202512", "202612"]);
  // A period the start date falls inside is kept.
  const quarters = listVatPeriods(soleTrader("quarterly"), now, day("2026-05-20")).map((p) => p.skvPeriod);
  assert.deepEqual(quarters, ["202606", "202609", "202612"]);

  // The start date is the earlier of the fiscal year start and the first booked entry.
  const fresh = await prisma.business.create({
    data: {
      name: "Ny Firma",
      fiscalYearStart: day("2046-01-01"),
      accounts: {
        create: swedishSoleTraderDefaultAccounts.map((a) => ({ code: a.code, name: a.name, type: a.type, vatCode: a.vatCode }))
      }
    }
  });
  assert.equal(iso(await vatActiveFrom(fresh)), "2046-01-01");
  await createCashMethodTransaction({
    businessId: fresh.id,
    txnDate: day("2046-03-10"),
    description: "After the start",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 125,
    vatRate: 0.25,
    source: EntrySources.MANUAL
  });
  assert.equal(iso(await vatActiveFrom(fresh)), "2046-01-01");
  await createCashMethodTransaction({
    businessId: fresh.id,
    txnDate: day("2045-09-03"),
    description: "Imported history",
    direction: TransactionDirections.EXPENSE,
    grossAmount: 125,
    vatRate: 0.25,
    source: EntrySources.SIE_IMPORT
  });
  assert.equal(iso(await vatActiveFrom(fresh)), "2045-09-03");
});

test("the period opened by default is the oldest unfiled one that is due, else the running one", () => {
  const options = soleTrader("quarterly");
  const rowsOn = (today: string, filed: string[] = [], activeFrom: Date | null = null) =>
    listVatPeriods(options, day(today), activeFrom).map((period) => ({
      period,
      status: vatPeriodStatus(period, { filed: filed.includes(period.skvPeriod), today })
    }));
  const pick = (today: string, filed: string[] = [], activeFrom: Date | null = null) =>
    pickDefaultVatPeriod(rowsOn(today, filed, activeFrom), today)?.period.skvPeriod;

  // New business in November 2026: Q1 to Q3 2026 are overdue or ready, the oldest comes first.
  assert.equal(pick("2026-11-15", [], day("2026-01-01")), "202603");
  // Once the older ones are filed, the next unfiled one that is due.
  assert.equal(pick("2026-11-15", ["202603", "202606"], day("2026-01-01")), "202609");
  // Nothing due: the period running today, not a later upcoming one and not a filed one.
  assert.equal(pick("2026-11-15", ["202603", "202606", "202609"], day("2026-01-01")), "202612");
  // A ready period wins over the running one.
  assert.equal(pick("2026-10-05", ["202603", "202606"], day("2026-01-01")), "202609");

  // Yearly filer registered this year: the running year, never last year.
  const yearly = listVatPeriods(soleTrader("yearly"), day("2026-11-15"), day("2026-01-01")).map((period) => ({
    period,
    status: vatPeriodStatus(period, { filed: false, today: "2026-11-15" })
  }));
  assert.equal(pickDefaultVatPeriod(yearly, "2026-11-15")?.period.skvPeriod, "202612");
  assert.equal(pickDefaultVatPeriod(yearly, "2026-11-15")?.status, "upcoming");
  assert.equal(pickDefaultVatPeriod([], "2026-11-15"), null);
});

// ─── The file ────────────────────────────────────────────────────────────────

test("the file is well formed eSKDUpload 6.0 and carries the box values", async () => {
  const declaration = await buildMomsdeklaration({ businessId, ...month(1) });
  const xml = buildEskdXml({ orgNr: "850101-1234", skvPeriod: "204101", boxes: declaration.boxes });

  assert.equal(
    xml,
    [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<eSKDUpload Version="6.0">',
      "<OrgNr>850101-1234</OrgNr>",
      "<Moms>",
      "<Period>204101</Period>",
      "<ForsMomsEjAnnan>2500</ForsMomsEjAnnan>",
      "<MomsUtgHog>250</MomsUtgHog>",
      "<MomsUtgMedel>120</MomsUtgMedel>",
      "<MomsUtgLag>30</MomsUtgLag>",
      "<MomsIngAvdr>137</MomsIngAvdr>",
      "<MomsBetala>263</MomsBetala>",
      "</Moms>",
      "</eSKDUpload>"
    ].join("\n")
  );

  const parsed = parseSimpleXml(xml);
  assert.equal(parsed.encoding, "ISO-8859-1");
  assert.deepEqual(parsed.values, [
    { path: "eSKDUpload/OrgNr", value: "850101-1234" },
    { path: "eSKDUpload/Moms/Period", value: "204101" },
    { path: "eSKDUpload/Moms/ForsMomsEjAnnan", value: "2500" },
    { path: "eSKDUpload/Moms/MomsUtgHog", value: "250" },
    { path: "eSKDUpload/Moms/MomsUtgMedel", value: "120" },
    { path: "eSKDUpload/Moms/MomsUtgLag", value: "30" },
    { path: "eSKDUpload/Moms/MomsIngAvdr", value: "137" },
    { path: "eSKDUpload/Moms/MomsBetala", value: "263" }
  ]);

  // Every byte is ISO-8859-1 (here plain ASCII) and there are no tabs or stray spaces.
  const bytes = encodeEskdXml(xml);
  assert.equal(bytes.length, xml.length);
  assert.ok(bytes.every((b) => b < 0x80));
  assert.ok(!/\t| \n|\n /.test(xml));
});

test("the file leaves out empty boxes, always has box 49 and writes a refund with a minus sign", async () => {
  const refund = await buildMomsdeklaration({ businessId, ...month(5) });
  const refundXml = buildEskdXml({ orgNr: "850101-1234", skvPeriod: "204105", boxes: refund.boxes });
  parseSimpleXml(refundXml);
  assert.ok(refundXml.includes("<MomsBetala>-750</MomsBetala>"));
  assert.ok(!refundXml.includes("MomsUtgMedel"));
  assert.ok(!refundXml.includes("MomsUtgLag"));

  // Nothing to declare: Skatteverket's example has only MomsBetala 0.
  const empty = await buildMomsdeklaration({ businessId, ...month(12) });
  const emptyXml = buildEskdXml({ orgNr: "850101-1234", skvPeriod: "204112", boxes: empty.boxes });
  assert.deepEqual(parseSimpleXml(emptyXml).values, [
    { path: "eSKDUpload/OrgNr", value: "850101-1234" },
    { path: "eSKDUpload/Moms/Period", value: "204112" },
    { path: "eSKDUpload/Moms/MomsBetala", value: "0" }
  ]);

  assert.throws(() => buildEskdXml({ orgNr: "8501011234", skvPeriod: "204101", boxes: empty.boxes }), /OrgNr/);
  assert.throws(() => buildEskdXml({ orgNr: "850101-1234", skvPeriod: "2041-01", boxes: empty.boxes }), /Period/);
  assert.throws(
    () => buildEskdXml({ orgNr: "850101-1234", skvPeriod: "204101", boxes: { ...empty.boxes, "05": 10.5 } }),
    /whole kronor/
  );
});

test("identity numbers are normalised to ten digits with a hyphen", () => {
  assert.equal(normalizeOrgNr("850101-1234"), "850101-1234");
  assert.equal(normalizeOrgNr("8501011234"), "850101-1234");
  assert.equal(normalizeOrgNr("19850101-1234"), "850101-1234");
  assert.equal(normalizeOrgNr("198501011234"), "850101-1234");
  assert.equal(normalizeOrgNr("556000-0175"), "556000-0175");
  assert.equal(normalizeOrgNr("SE556000017501"), "556000-0175");
  assert.equal(normalizeOrgNr("SE 5560000175 01"), "556000-0175");
  assert.equal(normalizeOrgNr("12345"), null);
  assert.equal(normalizeOrgNr("not a number"), null);
  assert.equal(normalizeOrgNr(null), null);
});

// ─── Recording a filed return ────────────────────────────────────────────────

test("recording a filed return stores the figures, locks the period and writes audit rows", async () => {
  await sale(9, 1250, 0.25);
  await purchase(9, 250, 0.25);
  const [september] = generateVatPeriods(2041, soleTrader("monthly")).filter((p) => p.skvPeriod === "204109");

  assert.equal(await findMomsFiling(businessId, september), null);
  const result = await recordMomsFiling({ businessId, period: september, lock: true });

  assert.equal(result.locked, true);
  assert.equal(result.lockError, null);
  assert.equal(result.filing.filingType, "MOMS");
  assert.equal(result.filing.status, "SUBMITTED");
  assert.ok(result.filing.submittedAt);
  assert.deepEqual(filedBoxes(result.filing.payloadJson), { "05": 1000, "10": 250, "11": 0, "12": 0, "48": 50, "49": 200 });

  const stored = await findMomsFiling(businessId, september);
  assert.equal(stored?.id, result.filing.id);

  const lock = await prisma.periodLock.findFirst({ where: { businessId, periodStart: september.start, periodEnd: september.end } });
  assert.ok(lock, "the period must be locked");
  await assert.rejects(sale(9, 100, 0.25), LedgerError);

  const filedAudit = await prisma.auditLog.findFirst({
    where: { businessId, entityType: "Filing", entityId: result.filing.id, action: "VAT_RETURN_FILED" }
  });
  assert.ok(filedAudit, "filing must write an audit row");
  const lockAudit = await prisma.auditLog.findFirst({ where: { businessId, entityType: "PeriodLock", entityId: lock.id, action: "LOCK" } });
  assert.ok(lockAudit, "locking must write an audit row");

  // A period can only be recorded as filed once.
  await assert.rejects(recordMomsFiling({ businessId, period: september, lock: true }), MomsFilingError);
});

test("recording without the lock leaves the period open", async () => {
  await sale(10, 1250, 0.25);
  const [october] = generateVatPeriods(2041, soleTrader("monthly")).filter((p) => p.skvPeriod === "204110");

  const result = await recordMomsFiling({ businessId, period: october, lock: false });
  assert.equal(result.locked, false);
  assert.equal(await prisma.periodLock.count({ where: { businessId, periodStart: october.start } }), 0);
  await sale(10, 100, 0.25);
});
