/**
 * Tests for ROT and RUT on invoices: the reduction at the rates in force on
 * different dates, the buyer's details, what the customer owes, the request
 * file for Skatteverket, and how the payout is booked.
 *
 * The pure rules need no database. The rest runs against a real PostgreSQL
 * database built from prisma/migrations (see scripts/test.sh).
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { asNumber } from "@/lib/accounting/math";
import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { suggestYearEndReceivables } from "@/lib/accounting/journalTemplates";
import {
  invoiceAmounts,
  invoiceBalanceInclude,
  invoiceOpenAmounts,
  loadUnreportedInvoiceVat,
  storedStatusFor
} from "@/lib/invoices/balance";
import { createInvoiceRecord, type CreateInvoiceInput } from "@/lib/invoices/create";
import { createCreditNote, CreditError } from "@/lib/invoices/credit";
import { defaultReminderEmail } from "@/lib/invoices/delivery";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { registerInvoicePayment, registerPaymentByReference } from "@/lib/invoices/payments";
import { buildInvoicePdf } from "@/lib/invoices/pdf";
import { reminderDecision } from "@/lib/invoices/reminders";
import {
  assertRotRutLines,
  buildRotRutCase,
  buildRotRutRequestXml,
  computeRotRut,
  maskPersonnummer,
  parseOrgNumber,
  parsePersonnummer,
  rotRutBlocksPaymentUndo,
  rotRutCapFor,
  rotRutDeadline,
  rotRutDeadlineState,
  RotRutError,
  rotRutRateFor,
  rotRutSchemaVersionFor,
  rotRutStage,
  toTwelveDigitId,
  validateRotRutBuyer
} from "@/lib/invoices/rotrut";
import {
  buildRotRutRequestFile,
  loadRotRutQueue,
  markRotRutRequested,
  registerRotRutPayout,
  undoRotRutPayout
} from "@/lib/invoices/rotrut-actions";
import { computeInvoiceStatus } from "@/lib/invoices/status";
import { toInvoiceRow } from "@/lib/invoices/view";
import { buildMomsdeklaration } from "@/lib/tax/momsdeklaration";
import { buildYearEndOverview } from "@/lib/tax/neYearEnd";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run ROT/RUT tests against "${dbName}". Use a database whose name ends in _test.`);
}

// No test may ever send a real email: with no provider configured, sending fails cleanly.
for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY"]) delete process.env[key];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const rejectsWith = (code: string) => (error: unknown) => {
  assert.ok(error instanceof RotRutError, `expected a RotRutError, got ${String(error)}`);
  assert.equal(error.code, code);
  return true;
};

// Test numbers with valid check digits. 19121212-1212 is the number Skatteverket uses in its own examples.
const BUYER = "19121212-1212";
const BUYER_12 = "191212121212";
const SELLER = "19811218-9876";

// ─── Rates, caps and the reduction ───────────────────────────────────────────

test("the rate and the yearly cap follow the date", () => {
  // ROT was 30 %, temporarily 50 % for work paid 12 May to 31 December 2025, and is 30 % again from 2026.
  assert.equal(rotRutRateFor("ROT", "2024-03-01"), 0.3);
  assert.equal(rotRutRateFor("ROT", "2025-05-11"), 0.3);
  assert.equal(rotRutRateFor("ROT", "2025-05-12"), 0.5);
  assert.equal(rotRutRateFor("ROT", "2025-12-31"), 0.5);
  assert.equal(rotRutRateFor("ROT", "2026-01-01"), 0.3);
  assert.equal(rotRutRateFor("ROT", day("2026-11-15")), 0.3);
  for (const date of ["2021-06-01", "2025-06-01", "2026-06-01"]) assert.equal(rotRutRateFor("RUT", date), 0.5);

  // 75 000 kr together, of which at most 50 000 kr ROT. From 1 July 2024 and for that year: 75 000 kr each.
  assert.equal(rotRutCapFor("ROT", "2023-05-01"), 50_000);
  assert.equal(rotRutCapFor("RUT", "2023-05-01"), 75_000);
  assert.equal(rotRutCapFor("ROT", "2024-06-30"), 50_000);
  assert.equal(rotRutCapFor("ROT", "2024-07-01"), 75_000);
  assert.equal(rotRutCapFor("ROT", "2025-08-01"), 50_000);
  assert.equal(rotRutCapFor("ROT", "2026-02-01"), 50_000);
  assert.equal(rotRutCapFor("RUT", "2026-02-01"), 75_000);
});

// Skatteverket's own example: labour 10 000, material 8 000, travel 400, all plus 25 % VAT.
const mixedLines = [
  { totalAmount: 12_500, labour: true, workType: "BYGG", hours: 16 },
  { totalAmount: 10_000, labour: false, workType: "BYGG" },
  { totalAmount: 500, labour: false, workType: null }
];

test("the reduction counts labour including VAT only, never material or travel", () => {
  const rot = computeRotRut({ type: "ROT", date: "2026-03-01", lines: mixedLines });
  assert.equal(rot.grossAmount, 23_000);
  assert.equal(rot.labourAmount, 12_500);
  assert.equal(rot.materialAmount, 10_000);
  assert.equal(rot.otherAmount, 500);
  assert.equal(rot.rate, 0.3);
  assert.equal(rot.deduction, 3_750);
  assert.equal(rot.customerPays, 19_250);
  assert.equal(rot.capped, false);

  // The same invoice dated while ROT was 50 %.
  const rot2025 = computeRotRut({ type: "ROT", date: "2025-09-01", lines: mixedLines });
  assert.equal(rot2025.deduction, 6_250);
  assert.equal(rot2025.customerPays, 16_750);

  // RUT: 50 % of the labour.
  const rut = computeRotRut({
    type: "RUT",
    date: "2026-03-01",
    lines: [
      { totalAmount: 2_000, labour: true, workType: "STADNING", hours: 4 },
      { totalAmount: 250, labour: false, workType: "STADNING" }
    ]
  });
  assert.equal(rut.deduction, 1_000);
  assert.equal(rut.customerPays, 1_250);
});

test("the reduction is in whole kronor, rounded down, and stops at the yearly cap", () => {
  // 30 % of 1 234,56 is 370,37: the request takes no öre.
  const odd = computeRotRut({ type: "ROT", date: "2026-03-01", lines: [{ totalAmount: 1_234.56, labour: true, workType: "EL", hours: 2 }] });
  assert.equal(odd.deduction, 370);
  assert.equal(odd.customerPays, 864.56);

  const big = [{ totalAmount: 400_000, labour: true, workType: "BYGG", hours: 500 }];
  const capped = computeRotRut({ type: "ROT", date: "2026-03-01", lines: big });
  assert.equal(capped.deduction, 50_000);
  assert.equal(capped.capped, true);
  assert.equal(computeRotRut({ type: "ROT", date: "2024-09-01", lines: big }).deduction, 75_000);
  assert.equal(computeRotRut({ type: "RUT", date: "2026-03-01", lines: [{ ...big[0], workType: "STADNING" }] }).deduction, 75_000);
});

test("labour lines need a type of work and hours", () => {
  assert.doesNotThrow(() => assertRotRutLines("ROT", mixedLines));
  assert.throws(() => assertRotRutLines("ROT", mixedLines.map((line) => ({ ...line, labour: false }))), rejectsWith("no_labour"));
  // A RUT type on a ROT invoice is not accepted.
  assert.throws(() => assertRotRutLines("ROT", [{ totalAmount: 100, labour: true, workType: "STADNING", hours: 1 }]), rejectsWith("work_type"));
  assert.throws(() => assertRotRutLines("ROT", [{ totalAmount: 100, labour: true, workType: "BYGG", hours: 0 }]), rejectsWith("hours"));
  assert.throws(() => assertRotRutLines("ROT", [{ totalAmount: 100, labour: true, workType: "BYGG", hours: 1200 }]), rejectsWith("hours_too_many"));
});

// ─── Personnummer and property ───────────────────────────────────────────────

test("a personnummer is checked for format, date and check digit", () => {
  const today = day("2026-11-15");
  assert.deepEqual(parsePersonnummer("19121212-1212", today), { ok: true, value: "191212121212", birthYear: 1912 });
  assert.deepEqual(parsePersonnummer("191212121212", today), { ok: true, value: "191212121212", birthYear: 1912 });
  // Ten digits: the century is worked out. "+" means the person has turned 100.
  assert.deepEqual(parsePersonnummer("811218-9876", today), { ok: true, value: "198112189876", birthYear: 1981 });
  assert.deepEqual(parsePersonnummer("121212+1212", today), { ok: true, value: "191212121212", birthYear: 1912 });
  assert.deepEqual(parsePersonnummer("8112189876", today), { ok: true, value: "198112189876", birthYear: 1981 });

  assert.deepEqual(parsePersonnummer("811218-9877", today), { ok: false, reason: "checksum" });
  assert.deepEqual(parsePersonnummer("811318-9876", today), { ok: false, reason: "date" });
  assert.deepEqual(parsePersonnummer("19810230-1234", today), { ok: false, reason: "date" });
  assert.deepEqual(parsePersonnummer("81121-9876", today), { ok: false, reason: "format" });
  assert.deepEqual(parsePersonnummer("hello", today), { ok: false, reason: "format" });

  // A samordningsnummer has 60 added to the day.
  const coordination = parsePersonnummer("701063-2391", today);
  assert.equal(coordination.ok, true);

  assert.equal(maskPersonnummer("198112189876"), "19811218-****");
  assert.equal(maskPersonnummer(null), "****");
});

test("an organisation number is checked with modulus 10 and written with twelve digits in the file", () => {
  assert.deepEqual(parseOrgNumber("556036-0793"), { ok: true, value: "556036-0793" });
  assert.deepEqual(parseOrgNumber("5560360793"), { ok: true, value: "556036-0793" });
  assert.deepEqual(parseOrgNumber("556036-0794"), { ok: false, reason: "checksum" });
  assert.deepEqual(parseOrgNumber("12345"), { ok: false, reason: "format" });
  assert.equal(toTwelveDigitId("556036-0793"), "165560360793");
  assert.equal(toTwelveDigitId("811218-9876", day("2026-11-15")), "198112189876");
  assert.equal(toTwelveDigitId("nonsense"), null);
});

test("ROT needs the property or the housing society and apartment; RUT needs neither", () => {
  const context = { year: 2026, performerId: SELLER, today: day("2026-11-15") };

  const house = validateRotRutBuyer("ROT", { personnummer: BUYER, housing: "property", propertyDesignation: " Sollentuna  Eken 12 " }, context);
  assert.equal(house.personnummer, BUYER_12);
  assert.equal(house.propertyDesignation, "Sollentuna Eken 12");

  const flat = validateRotRutBuyer(
    "ROT",
    { personnummer: BUYER, housing: "apartment", brfOrgNumber: "5560360793", apartmentNumber: "1102" },
    context
  );
  assert.equal(flat.brfOrgNumber, "556036-0793");
  assert.equal(flat.apartmentNumber, "1102");
  assert.equal(flat.propertyDesignation, undefined);

  assert.throws(() => validateRotRutBuyer("ROT", { personnummer: BUYER, housing: "property" }, context), rejectsWith("property_missing"));
  assert.throws(
    () => validateRotRutBuyer("ROT", { personnummer: BUYER, housing: "property", propertyDesignation: "x".repeat(41) }, context),
    rejectsWith("property_too_long")
  );
  assert.throws(
    () => validateRotRutBuyer("ROT", { personnummer: BUYER, housing: "apartment", brfOrgNumber: "556036-0794", apartmentNumber: "1102" }, context),
    rejectsWith("brf_org_number")
  );
  assert.throws(
    () => validateRotRutBuyer("ROT", { personnummer: BUYER, housing: "apartment", brfOrgNumber: "556036-0793" }, context),
    rejectsWith("apartment_number")
  );

  const rut = validateRotRutBuyer("RUT", { personnummer: BUYER }, context);
  assert.equal(rut.housing, undefined);

  // Skatteverket's own checks on the buyer.
  assert.throws(() => validateRotRutBuyer("RUT", { personnummer: "811218-9877" }, context), rejectsWith("personnummer_checksum"));
  assert.throws(() => validateRotRutBuyer("RUT", { personnummer: SELLER }, context), rejectsWith("buyer_is_seller"));
  assert.throws(() => validateRotRutBuyer("RUT", { personnummer: "20121212-1212" }, context), rejectsWith("buyer_too_young"));
});

// ─── Request values, file and deadline ───────────────────────────────────────

const houseDetails = {
  v: 1 as const,
  personnummer: BUYER_12,
  housing: "property" as const,
  propertyDesignation: "Sollentuna Eken 12",
  subcontractor: false,
  staffingAgency: true,
  rate: 0.3
};

test("the request carries labour cost, what the customer paid and what is requested, in whole kronor", () => {
  const item = buildRotRutCase({
    type: "ROT",
    invoiceNumber: "INV-2026-0042",
    details: houseDetails,
    deduction: 3_750,
    paymentDate: day("2026-04-20"),
    lines: [...mixedLines, { totalAmount: 2_500, labour: true, workType: "EL", hours: 2.4 }]
  });
  assert.equal(item.buyer, BUYER_12);
  assert.equal(item.paymentDate, "2026-04-20");
  // Labour 12 500 + 2 500 including VAT; the customer paid that minus the reduction.
  assert.equal(item.labourCost, 15_000);
  assert.equal(item.requestedAmount, 3_750);
  assert.equal(item.paidAmount, 11_250);
  assert.ok(item.requestedAmount + item.paidAmount <= item.labourCost);
  // Hours and material per type of work; travel is "other cost".
  assert.deepEqual(item.works, [
    { type: "BYGG", hours: 16, material: 10_000 },
    { type: "EL", hours: 2, material: 0 }
  ]);
  assert.equal(item.otherCost, 500);
  assert.equal(item.propertyDesignation, "Sollentuna Eken 12");
});

test("the request file follows Skatteverket's schema: names, order and namespace", () => {
  const rot = buildRotRutCase({
    type: "ROT",
    invoiceNumber: "INV-2026-0042",
    details: houseDetails,
    deduction: 3_750,
    paymentDate: day("2026-04-20"),
    lines: mixedLines
  });
  const xml = buildRotRutRequestXml({ version: "1.0", type: "ROT", name: "ROT 2026-11-15", performer: "198112189876", cases: [rot] });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<p:Begaran xmlns:p="http:\/\/xmls\.skatteverket\.se\/se\/skatteverket\/skattered\/begaran\/1\.0">/);
  const elements = [...xml.matchAll(/<p:([A-Za-z]+)>/g)].map((match) => match[1]);
  assert.deepEqual(elements, [
    "NamnPaBegaran",
    "TypAvBegaran",
    "Utforare",
    "Arende",
    "FakturaNr",
    "Kopare",
    "Fastighet",
    "Fastighetsbeteckning",
    "UtfortArbete",
    "TypAvUtfortArbete",
    "AntalTimmar",
    "Kostnad",
    "OvrigKostnad",
    "Betalningsdatum",
    "Arbetskostnad",
    "BetaltBelopp",
    "BegartBelopp"
  ]);
  for (const expected of [
    "<p:NamnPaBegaran>ROT 2026-11-15</p:NamnPaBegaran>",
    "<p:TypAvBegaran>ROT</p:TypAvBegaran>",
    "<p:Utforare>198112189876</p:Utforare>",
    "<p:FakturaNr>INV-2026-0042</p:FakturaNr>",
    `<p:Kopare>${BUYER_12}</p:Kopare>`,
    "<p:Fastighetsbeteckning>Sollentuna Eken 12</p:Fastighetsbeteckning>",
    "<p:TypAvUtfortArbete>BYGG</p:TypAvUtfortArbete>",
    "<p:AntalTimmar>16</p:AntalTimmar>",
    "<p:Kostnad>10000</p:Kostnad>",
    "<p:OvrigKostnad>500</p:OvrigKostnad>",
    "<p:Betalningsdatum>2026-04-20</p:Betalningsdatum>",
    "<p:Arbetskostnad>12500</p:Arbetskostnad>",
    "<p:BetaltBelopp>8750</p:BetaltBelopp>",
    "<p:BegartBelopp>3750</p:BegartBelopp>"
  ]) {
    assert.ok(xml.includes(expected), `missing ${expected}`);
  }

  // Version 1.1 (requests from 2027) adds the two answers after the amounts.
  assert.equal(rotRutSchemaVersionFor(day("2026-12-31")), "1.0");
  assert.equal(rotRutSchemaVersionFor(day("2027-01-01")), "1.1");
  const next = buildRotRutRequestXml({ version: "1.1", type: "ROT", name: "ROT", performer: "198112189876", cases: [rot] });
  assert.match(next, /begaran\/1\.1">/);
  assert.match(next, /<p:BegartBelopp>3750<\/p:BegartBelopp>\n\s*<p:Underentreprenor>false<\/p:Underentreprenor>\n\s*<p:Bemanningsforetag>true<\/p:Bemanningsforetag>/);

  // A flat: apartment number and the housing society's number, twelve digits. RUT: no property at all.
  const flat = buildRotRutCase({
    type: "ROT",
    invoiceNumber: "A&B <1>",
    details: { ...houseDetails, housing: "apartment", propertyDesignation: undefined, brfOrgNumber: "556036-0793", apartmentNumber: "1102" },
    deduction: 3_750,
    paymentDate: "2026-04-20",
    lines: mixedLines
  });
  const flatXml = buildRotRutRequestXml({ version: "1.0", type: "ROT", name: "ROT", performer: "198112189876", cases: [flat] });
  assert.match(flatXml, /<p:Fastighet>\n\s*<p:LagenhetsNr>1102<\/p:LagenhetsNr>\n\s*<p:BrfOrgNr>165560360793<\/p:BrfOrgNr>\n\s*<\/p:Fastighet>/);
  assert.ok(flatXml.includes("<p:FakturaNr>A&amp;B &lt;1&gt;</p:FakturaNr>"));

  const rut = buildRotRutCase({
    type: "RUT",
    invoiceNumber: "INV-1",
    details: { ...houseDetails, rate: 0.5 },
    deduction: 1_000,
    paymentDate: "2026-04-20",
    lines: [{ totalAmount: 2_000, labour: true, workType: "STADNING", hours: 4 }]
  });
  const rutXml = buildRotRutRequestXml({ version: "1.0", type: "RUT", name: "RUT", performer: "198112189876", cases: [rut] });
  assert.ok(!rutXml.includes("Fastighet"));
  assert.ok(rutXml.includes("<p:BetaltBelopp>1000</p:BetaltBelopp>"));

  // One file: one payment year, at most 100 buyers, and the business's own number.
  assert.throws(
    () => buildRotRutRequestXml({ version: "1.0", type: "ROT", name: "x", performer: "198112189876", cases: [rot, { ...rot, paymentDate: "2025-12-30" }] }),
    rejectsWith("mixed_years")
  );
  assert.throws(
    () => buildRotRutRequestXml({ version: "1.0", type: "ROT", name: "x", performer: "198112189876", cases: Array.from({ length: 101 }, () => rot) }),
    rejectsWith("too_many")
  );
  assert.throws(() => buildRotRutRequestXml({ version: "1.0", type: "ROT", name: "x", performer: "8112189876", cases: [rot] }), rejectsWith("performer_id"));
});

test("the request is due by 31 January the year after the customer paid", () => {
  const deadline = rotRutDeadline(day("2026-04-20"));
  assert.equal(deadline.toISOString().slice(0, 10), "2027-01-31");
  assert.deepEqual(rotRutDeadlineState(deadline, day("2026-11-15")), { daysLeft: 77, passed: false, soon: false });
  assert.equal(rotRutDeadlineState(deadline, day("2027-01-10")).soon, true);
  assert.equal(rotRutDeadlineState(deadline, day("2027-02-01")).passed, true);
});

test("where the request stands follows the customer's payment, the stamp and the payout", () => {
  const base = { rotRutType: "ROT", status: "UNPAID", creditedAmount: 0, remaining: 19_250, rotRutRequestedAt: null, rotRutPaidOutAt: null };
  assert.equal(rotRutStage({ ...base, rotRutType: null }), null);
  assert.equal(rotRutStage(base), "awaiting_customer");
  assert.equal(rotRutStage({ ...base, status: "PAID", remaining: 0 }), "ready");
  assert.equal(rotRutStage({ ...base, status: "PAID", remaining: 0, rotRutRequestedAt: day("2026-05-01") }), "requested");
  assert.equal(rotRutStage({ ...base, remaining: 1_750, rotRutRequestedAt: day("2026-05-01"), rotRutPaidOutAt: day("2026-05-10") }), "paid_out");
  assert.equal(rotRutStage({ ...base, creditedAmount: 23_000, remaining: 0 }), "cancelled");
});

// ─── The PDF ─────────────────────────────────────────────────────────────────

/** Every text string in the PDF, in order, with Swedish letters and spaces decoded. */
const pdfStrings = (buffer: Buffer) =>
  [...buffer.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((match) =>
    match[1]
      .replace(/\\(\d{3})/g, (_all, octal: string) => String.fromCharCode(parseInt(octal, 8)))
      .replace(/\\([()\\])/g, "$1")
      .replace(/\u00a0/g, " ")
  );

const rotPdf = (overrides: { approvedAmount?: number | null; paidAmount?: number } = {}) =>
  pdfStrings(
    buildInvoicePdf({
      invoiceNumber: "INV-2026-0042",
      issueDate: day("2026-04-01"),
      dueDate: day("2026-04-30"),
      currency: "SEK",
      sender: { name: "Åsa Öberg Snickeri", registration: "811218-9876" },
      customer: { name: "Kim Kund", address: "Ekvägen 12, 191 40 Sollentuna" },
      items: [
        { description: "Snickeriarbete", quantity: 16, unitPrice: 625, netAmount: 10_000, vatAmount: 2_500, totalAmount: 12_500, vatRate: 0.25 },
        { description: "Material", quantity: 1, unitPrice: 8_000, netAmount: 8_000, vatAmount: 2_000, totalAmount: 10_000, vatRate: 0.25 },
        { description: "Resa", quantity: 1, unitPrice: 400, netAmount: 400, vatAmount: 100, totalAmount: 500, vatRate: 0.25 }
      ],
      subtotalAmount: 18_400,
      vatAmount: 4_600,
      grossAmount: 23_000,
      locale: "sv",
      ocrReference: "123456790",
      paymentAccounts: { bankgiro: "991-2346" },
      fSkattRegistered: true,
      paidAmount: overrides.paidAmount,
      rotRut: {
        type: "ROT",
        rate: 0.3,
        labourAmount: 12_500,
        materialAmount: 10_000,
        otherAmount: 500,
        deduction: 3_750,
        approvedAmount: overrides.approvedAmount,
        personnummer: BUYER,
        property: "Sollentuna Eken 12",
        works: [{ label: "Bygg", hours: 16 }]
      }
    })
  );

test("the PDF shows labour, the preliminary reduction and what the customer pays", () => {
  const strings = rotPdf();
  const text = strings.join(" ");
  const amountAfter = (label: string) => strings[strings.indexOf(label) + 1];
  assert.equal(amountAfter("Summa inkl. moms"), "23 000,00 kr");
  assert.equal(amountAfter("Varav arbete inkl. moms"), "12 500,00 kr");
  assert.equal(amountAfter("Preliminärt rotavdrag 30 %"), "-3 750,00 kr");
  assert.equal(amountAfter("Att betala"), "19 250,00 kr");
  // The payment block asks for the customer's part, never the whole invoice.
  assert.equal(amountAfter("ATT BETALA"), "19 250,00 kr");
  assert.equal(strings.includes("Summa att betala"), false);
  // What the invoice has to say: the buyer, the home, the work, F-skatt, electronic payment.
  assert.match(text, /personnummer 19121212-1212/);
  assert.match(text, /Sollentuna Eken 12/);
  assert.match(text, /Bygg, 16 timmar/);
  assert.match(text, /Godkänd för F-skatt/);
  assert.match(text, /elektroniskt/);
  assert.match(text, /mellanskillnaden/);
});

test("after a reduced payout the PDF asks the customer for the difference", () => {
  const strings = rotPdf({ approvedAmount: 2_000, paidAmount: 19_250 });
  const text = strings.join(" ");
  const amountAfter = (label: string) => strings[strings.indexOf(label) + 1];
  assert.equal(amountAfter("Ej godkänt av Skatteverket"), "1 750,00 kr");
  // To pay in all 21 000, paid 19 250, left 1 750.
  assert.equal(amountAfter("Att betala"), "21 000,00 kr");
  assert.equal(amountAfter("Kvar att betala"), "1 750,00 kr");
  assert.equal(amountAfter("ATT BETALA"), "1 750,00 kr");
  assert.match(text, /Skatteverket har betalat ut 2 000,00 kr av de 3 750,00 kr/);
});

// ─── Database: balance, status, reminders, request, payout ───────────────────

let businessId = "";

before(async () => {
  const business = await prisma.business.create({
    data: {
      name: "Rot Test Snickeri",
      locale: "sv",
      fiscalYearStart: day("2031-01-01"),
      personnummer: SELLER,
      fSkattRegistered: true,
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

const rotInput = (overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput => ({
  businessId,
  customer: { name: "Kim Kund", email: "kim@example.se" },
  items: [
    { description: "Snickeriarbete", quantity: 16, unitPrice: 625, vatMode: "EXCLUSIVE", vatRate: 0.25, rotRutLabour: true, rotRutWorkType: "BYGG", rotRutHours: 16 },
    { description: "Material", quantity: 1, unitPrice: 8000, vatMode: "EXCLUSIVE", vatRate: 0.25, rotRutLabour: false, rotRutWorkType: "BYGG" },
    { description: "Resa", quantity: 1, unitPrice: 400, vatMode: "EXCLUSIVE", vatRate: 0.25, rotRutLabour: false, rotRutWorkType: null }
  ],
  issueDate: day("2031-04-01"),
  dueDate: day("2031-04-30"),
  emailTo: "kim@example.se",
  rotRut: { type: "ROT", personnummer: BUYER, housing: "property", propertyDesignation: "Sollentuna Eken 12" },
  ...overrides
});

/** A sent ROT invoice of 23 000 kr: labour 12 500, reduction 3 750, the customer pays 19 250. */
const rotInvoice = async (overrides: Partial<CreateInvoiceInput> = {}) => {
  const invoice = await prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput(overrides)));
  await prisma.invoice.update({ where: { id: invoice.id }, data: { sentAt: day("2031-04-01") } });
  return invoice;
};

/** Registers a customer payment the way the partial-pay route does. */
const payInvoice = async (invoiceId: string, amount: number, date: string) => {
  const transaction = await createTransaction({
    businessId,
    txnDate: day(date),
    description: "Payment",
    direction: TransactionDirections.INCOME,
    grossAmount: amount,
    vatRate: 0.25,
    source: EntrySources.INVOICE_PAYMENT,
    incomeAccountCode: "3001"
  });
  const payment = await prisma.invoicePayment.create({
    data: { businessId, invoiceId, transactionId: transaction.id, paymentDate: day(date), amount }
  });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceBalanceInclude });
  const status = storedStatusFor(invoiceAmounts({ ...invoice, status: "UNPAID" }));
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status, paidAt: status === "PAID" ? day(date) : null } });
  return { transaction, payment };
};

const balanceOf = async (invoiceId: string, today = "2031-04-10") => {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceBalanceInclude });
  const amounts = invoiceAmounts(invoice);
  return {
    invoice,
    amounts,
    status: computeInvoiceStatus({ status: invoice.status, ...amounts, dueDate: invoice.dueDate, sentAt: invoice.sentAt, today: day(today) }),
    row: toInvoiceRow(invoice, day(today), "sv")
  };
};

const ledgerLines = async (transactionId: string) => {
  const lines = await prisma.journalLine.findMany({ where: { transactionId }, include: { account: true } });
  return Object.fromEntries(lines.map((line) => [line.account.code, asNumber(line.debit) - asNumber(line.credit)]));
};

test("a ROT invoice stores the reduction and the customer owes only their part", async () => {
  const before = await prisma.transaction.count({ where: { businessId } });
  const invoice = await rotInvoice();
  // Issuing posts nothing (kontantmetoden).
  assert.equal(await prisma.transaction.count({ where: { businessId } }), before);

  assert.equal(invoice.rotRutType, "ROT");
  assert.equal(asNumber(invoice.grossAmount), 23_000);
  assert.equal(asNumber(invoice.rotRutDeduction), 3_750);
  assert.deepEqual(
    invoice.items.map((item) => [item.rotRutLabour, item.rotRutWorkType, item.rotRutHours === null ? null : asNumber(item.rotRutHours)]),
    [
      [true, "BYGG", 16],
      [false, "BYGG", null],
      [false, null, null]
    ]
  );
  // The personnummer is stored in the details only, with twelve digits.
  const details = JSON.parse(invoice.rotRutDetailsJson as string) as Record<string, unknown>;
  assert.equal(details.personnummer, BUYER_12);
  assert.equal(details.propertyDesignation, "Sollentuna Eken 12");
  assert.equal(details.rate, 0.3);

  const balance = await balanceOf(invoice.id);
  assert.equal(balance.amounts.grossAmount, 23_000);
  assert.equal(balance.amounts.skatteverketAmount, 3_750);
  assert.equal(balance.amounts.remainingAmount, 19_250);
  assert.deepEqual(balance.status, { kind: "DUE", remaining: 19_250, days: 20, overdue: false });
  assert.equal(balance.row.remaining, 19_250);
  assert.equal(balance.row.rotRut?.stage, "awaiting_customer");

  // The PDF data and the reminder ask for the customer's part.
  const loaded = await loadInvoiceForOutput({ businessId, invoiceId: invoice.id });
  assert.ok(loaded?.rotRut);
  assert.equal(loaded.remainingAmount, 19_250);
  assert.equal(loaded.rotRut.customerTotal, 19_250);
  assert.equal(loaded.rotRut.labourAmount, 12_500);
  assert.equal(loaded.rotRut.materialAmount, 10_000);
  assert.equal(loaded.rotRut.otherAmount, 500);
  assert.equal(loaded.rotRut.requestCase, null);
  const reminder = defaultReminderEmail(loaded, day("2031-05-10"));
  assert.match(reminder.body.replace(/ /g, " "), /Att betala: 19 250,00 kr/);
  assert.equal(reminder.body.replace(/\u00a0/g, " ").includes("23 000"), false);
});

test("an invoice dated while ROT was 50 % gets that rate, and RUT gets 50 %", async () => {
  const rot2025 = await rotInvoice({ issueDate: day("2025-09-01"), dueDate: day("2025-09-30") });
  assert.equal(asNumber(rot2025.rotRutDeduction), 6_250);

  const rut = await rotInvoice({
    items: [
      { description: "Städning", quantity: 4, unitPrice: 400, vatMode: "EXCLUSIVE", vatRate: 0.25, rotRutLabour: true, rotRutWorkType: "STADNING", rotRutHours: 4 },
      { description: "Rengöringsmedel", quantity: 1, unitPrice: 200, vatMode: "EXCLUSIVE", vatRate: 0.25, rotRutLabour: false, rotRutWorkType: "STADNING" }
    ],
    rotRut: { type: "RUT", personnummer: BUYER }
  });
  assert.equal(rut.rotRutType, "RUT");
  // Labour 2 000 including VAT: 1 000 from Skatteverket; the customer pays 1 000 + 250 material.
  assert.equal(asNumber(rut.rotRutDeduction), 1_000);
  assert.equal((await balanceOf(rut.id)).amounts.remainingAmount, 1_250);
});

test("the invoice is paid when the customer has paid their part, and reminders stop there", async () => {
  const invoice = await rotInvoice();

  // Part paid and past due: overdue on what is left of the customer's part.
  await payInvoice(invoice.id, 10_000, "2031-04-20");
  const part = await balanceOf(invoice.id, "2031-05-10");
  assert.equal(part.invoice.status, "PARTIAL");
  assert.deepEqual(part.status, { kind: "PARTLY_PAID", remaining: 9_250, days: 10, overdue: true });
  assert.equal(
    reminderDecision({
      status: part.invoice.status,
      remaining: part.amounts.remainingAmount,
      dueDate: part.invoice.dueDate,
      sentAt: part.invoice.sentAt,
      recipientEmail: "kim@example.se",
      reminderCount: 0,
      lastReminderAt: null,
      today: day("2031-05-10"),
      daysAfterDue: 5
    }).due,
    true
  );

  // The rest of the customer's part: paid, although Skatteverket's 3 750 has not arrived.
  await payInvoice(invoice.id, 9_250, "2031-05-11");
  const paid = await balanceOf(invoice.id, "2031-06-30");
  assert.equal(paid.invoice.status, "PAID");
  assert.deepEqual(paid.status, { kind: "PAID", remaining: 0, days: 0, overdue: false });
  assert.equal(paid.amounts.paidAmount, 19_250);
  assert.equal(paid.row.rotRut?.stage, "ready");

  // The reminder job only looks at UNPAID and PARTIAL invoices, and even then nothing is left to ask for.
  // (The job itself is not run here: it works across every business in the shared test database.)
  assert.deepEqual(
    reminderDecision({
      status: "PARTIAL",
      remaining: paid.amounts.remainingAmount,
      dueDate: paid.invoice.dueDate,
      sentAt: paid.invoice.sentAt,
      recipientEmail: "kim@example.se",
      reminderCount: 0,
      lastReminderAt: null,
      today: day("2031-06-30"),
      daysAfterDue: 5
    }),
    { due: false, reason: "settled" }
  );
});

test("request, full payout: the ledger and the VAT return follow the money", async () => {
  const invoice = await rotInvoice({ issueDate: day("2032-02-01"), dueDate: day("2032-02-28") });

  // Nothing can be requested or paid out before the customer has paid.
  await assert.rejects(buildRotRutRequestFile(prisma, { businessId, today: day("2032-03-01"), invoiceId: invoice.id }), rejectsWith("customer_unpaid"));
  await assert.rejects(markRotRutRequested(prisma, { businessId, invoiceIds: [invoice.id], sent: true }), rejectsWith("customer_unpaid"));
  await assert.rejects(
    registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2032-03-01"), amount: 3_750 }),
    rejectsWith("customer_unpaid")
  );

  const customer = await payInvoice(invoice.id, 19_250, "2032-02-20");
  // The customer's payment: bank 19 250, sales 15 400, output VAT 3 850.
  assert.deepEqual(await ledgerLines(customer.transaction.id), { "1930": 19_250, "3001": -15_400, "2610": -3_850 });

  // The queue shows it as ready, with the deadline, and never the full personnummer.
  const queue = await loadRotRutQueue(prisma, { businessId, today: day("2032-03-01") });
  const row = queue.rows.find((item) => item.id === invoice.id);
  assert.ok(row);
  assert.equal(row.stage, "ready");
  assert.equal(row.paymentDate, "2032-02-20");
  assert.equal(row.deadline, "2033-01-31");
  assert.equal(row.buyer, "19121212-****");
  assert.equal(JSON.stringify(queue.rows).includes(BUYER_12), false);
  const late = await loadRotRutQueue(prisma, { businessId, today: day("2033-01-20") });
  assert.equal(late.rows.find((item) => item.id === invoice.id)?.deadlineSoon, true);

  // The file for this one invoice.
  const file = await buildRotRutRequestFile(prisma, { businessId, today: day("2032-03-01"), invoiceId: invoice.id });
  assert.equal(file.fileName, "rot-begaran-2032-03-01.xml");
  for (const expected of [
    "begaran/1.1",
    "<p:Utforare>198112189876</p:Utforare>",
    `<p:FakturaNr>${invoice.invoiceNumber}</p:FakturaNr>`,
    `<p:Kopare>${BUYER_12}</p:Kopare>`,
    "<p:Fastighetsbeteckning>Sollentuna Eken 12</p:Fastighetsbeteckning>",
    "<p:AntalTimmar>16</p:AntalTimmar>",
    "<p:Kostnad>10000</p:Kostnad>",
    "<p:OvrigKostnad>500</p:OvrigKostnad>",
    "<p:Betalningsdatum>2032-02-20</p:Betalningsdatum>",
    "<p:Arbetskostnad>12500</p:Arbetskostnad>",
    "<p:BetaltBelopp>8750</p:BetaltBelopp>",
    "<p:BegartBelopp>3750</p:BegartBelopp>"
  ]) {
    assert.ok(file.xml.includes(expected), `missing ${expected}`);
  }

  // The file for everything ready of that type and payment year holds it too; another year does not.
  const batch = await buildRotRutRequestFile(prisma, { businessId, today: day("2032-03-01"), type: "ROT", year: 2032 });
  assert.ok(batch.invoiceIds.includes(invoice.id));
  assert.ok(batch.xml.includes(`<p:FakturaNr>${invoice.invoiceNumber}</p:FakturaNr>`));
  await assert.rejects(buildRotRutRequestFile(prisma, { businessId, today: day("2032-03-01"), type: "RUT", year: 2032 }), rejectsWith("nothing_ready"));

  // "I have sent the request".
  await markRotRutRequested(prisma, { businessId, invoiceIds: [invoice.id], sent: true, now: day("2032-03-01") });
  let stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(stored.rotRutRequestedAt?.toISOString().slice(0, 10), "2032-03-01");
  assert.equal((await balanceOf(invoice.id)).row.rotRut?.stage, "requested");
  // Once sent it leaves the "ready" file, and the customer's payment and the invoice are held in place.
  await assert.rejects(buildRotRutRequestFile(prisma, { businessId, today: day("2032-03-02"), type: "ROT", year: 2032 }), rejectsWith("nothing_ready"));
  assert.equal(rotRutBlocksPaymentUndo({ ...stored, settledAfterUndo: 0, customerPart: 19_250 }), "requested");
  await assert.rejects(
    createCreditNote(prisma, { businessId, invoiceId: invoice.id, amount: 23_000, issueDate: day("2032-03-02") }),
    (error: unknown) => error instanceof CreditError && error.code === "rot_rut_requested"
  );

  // Skatteverket pays all of it.
  const payout = await registerRotRutPayout(prisma, {
    businessId,
    invoiceId: invoice.id,
    paidOn: day("2032-03-15"),
    amount: 3_750,
    today: day("2032-03-20")
  });
  assert.equal(payout.shortfall, 0);
  assert.ok(payout.transaction);
  assert.equal(payout.transaction.direction, "INCOME");
  assert.equal(asNumber(payout.transaction.grossAmount), 3_750);
  assert.equal(asNumber(payout.transaction.netAmount), 3_000);
  assert.equal(asNumber(payout.transaction.vatAmount), 750);
  assert.deepEqual(await ledgerLines(payout.transaction.id), { "1930": 3_750, "3001": -3_000, "2610": -750 });

  stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(stored.rotRutPayoutTransactionId, payout.transaction.id);
  assert.equal(stored.rotRutPaidOutAt?.toISOString().slice(0, 10), "2032-03-15");
  assert.equal(stored.status, "PAID");
  const done = await balanceOf(invoice.id, "2032-06-01");
  assert.equal(done.amounts.remainingAmount, 0);
  assert.equal(done.amounts.skatteverketReceived, 3_750);
  assert.equal(done.row.rotRut?.stage, "paid_out");
  await assert.rejects(
    registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2032-03-16"), amount: 3_750 }),
    rejectsWith("already_paid_out")
  );

  // VAT return: February carries the customer's part, March the payout. Together the whole invoice.
  const february = await buildMomsdeklaration({ businessId, from: day("2032-02-01"), to: day("2032-02-29") });
  assert.equal(february.boxes["05"], 15_400);
  assert.equal(february.boxes["10"], 3_850);
  const march = await buildMomsdeklaration({ businessId, from: day("2032-03-01"), to: day("2032-03-31") });
  assert.equal(march.boxes["05"], 3_000);
  assert.equal(march.boxes["10"], 750);
  assert.equal(march.crossCheck.ok, true);
  assert.equal(february.boxes["05"] + march.boxes["05"], asNumber(invoice.subtotalAmount));
  assert.equal(february.boxes["10"] + march.boxes["10"], asNumber(invoice.vatAmount));

  // Undoing the payout cancels the entry with a correction and waits for Skatteverket again.
  await undoRotRutPayout(prisma, { businessId, invoiceId: invoice.id });
  stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(stored.rotRutPaidOutAt, null);
  assert.equal(stored.rotRutPayoutTransactionId, null);
  assert.equal(stored.status, "PAID");
  assert.ok((await prisma.transaction.findUniqueOrThrow({ where: { id: payout.transaction.id } })).voidedAt);
  const marchAfter = await buildMomsdeklaration({ businessId, from: day("2032-03-01"), to: day("2032-03-31") });
  assert.equal(marchAfter.boxes["05"], 0);
  assert.equal(marchAfter.boxes["10"], 0);
  assert.equal((await balanceOf(invoice.id)).row.rotRut?.stage, "requested");
});

test("a reduced payout books what arrived and reopens the difference for the customer", async () => {
  const invoice = await rotInvoice({ issueDate: day("2033-02-01"), dueDate: day("2033-02-28") });
  await payInvoice(invoice.id, 19_250, "2033-02-20");

  await assert.rejects(
    registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2033-03-15"), amount: 4_000 }),
    rejectsWith("payout_amount")
  );
  await assert.rejects(
    registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2033-02-10"), amount: 2_000 }),
    rejectsWith("payout_date")
  );

  // The customer's allowance was nearly used up: Skatteverket pays 2 000 of 3 750.
  const payout = await registerRotRutPayout(prisma, {
    businessId,
    invoiceId: invoice.id,
    paidOn: day("2033-03-15"),
    amount: 2_000,
    newDueDate: day("2033-04-14")
  });
  assert.equal(payout.shortfall, 1_750);
  assert.ok(payout.transaction);
  assert.deepEqual(await ledgerLines(payout.transaction.id), { "1930": 2_000, "3001": -1_600, "2610": -400 });

  // The invoice is open again for the difference, with the new date to pay by.
  const open = await balanceOf(invoice.id, "2033-03-20");
  assert.equal(open.invoice.status, "PARTIAL");
  assert.equal(open.invoice.paidAt, null);
  assert.equal(open.invoice.rotRutPayoutTransactionId, payout.transaction.id);
  assert.equal(open.invoice.dueDate?.toISOString().slice(0, 10), "2033-04-14");
  assert.equal(open.amounts.skatteverketAmount, 2_000);
  assert.equal(open.amounts.remainingAmount, 1_750);
  assert.deepEqual(open.status, { kind: "PARTLY_PAID", remaining: 1_750, days: 0, overdue: false });
  // The original reduction is kept as issued.
  assert.equal(asNumber(open.invoice.rotRutDeduction), 3_750);

  const loaded = await loadInvoiceForOutput({ businessId, invoiceId: invoice.id });
  assert.equal(loaded?.rotRut?.shortfall, 1_750);
  assert.equal(loaded?.rotRut?.payoutAmount, 2_000);
  assert.equal(loaded?.remainingAmount, 1_750);

  // March's VAT return holds only what Skatteverket paid.
  const march = await buildMomsdeklaration({ businessId, from: day("2033-03-01"), to: day("2033-03-31") });
  assert.equal(march.boxes["05"], 1_600);
  assert.equal(march.boxes["10"], 400);

  // The customer pays the difference: settled, and all of the invoice's VAT has been reported.
  const rest = await payInvoice(invoice.id, 1_750, "2033-04-10");
  const settled = await balanceOf(invoice.id, "2033-05-01");
  assert.equal(settled.invoice.status, "PAID");
  assert.equal(settled.amounts.remainingAmount, 0);
  const year = await buildMomsdeklaration({ businessId, from: day("2033-01-01"), to: day("2033-12-31") });
  assert.equal(year.boxes["05"], 18_400);
  assert.equal(year.boxes["10"], 4_600);

  // That last payment can be undone; the customer's original part cannot while the payout stands.
  assert.equal(
    rotRutBlocksPaymentUndo({ ...settled.invoice, settledAfterUndo: 21_000 - asNumber(rest.payment.amount), customerPart: 19_250 }),
    null
  );
  assert.equal(rotRutBlocksPaymentUndo({ ...settled.invoice, settledAfterUndo: 21_000 - 19_250, customerPart: 19_250 }), "paid_out");
  // And the payout cannot be undone while the customer has paid the difference.
  await assert.rejects(undoRotRutPayout(prisma, { businessId, invoiceId: invoice.id }), rejectsWith("customer_paid_shortfall"));
});

test("Skatteverket paying nothing books nothing and leaves the whole reduction to the customer", async () => {
  const invoice = await rotInvoice({ issueDate: day("2034-02-01"), dueDate: day("2034-02-28") });
  await payInvoice(invoice.id, 19_250, "2034-02-20");
  const before = await prisma.transaction.count({ where: { businessId } });
  const payout = await registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2034-03-15"), amount: 0 });
  assert.equal(payout.transaction, null);
  assert.equal(payout.shortfall, 3_750);
  assert.equal(await prisma.transaction.count({ where: { businessId } }), before);
  const open = await balanceOf(invoice.id, "2034-03-20");
  assert.equal(open.amounts.remainingAmount, 3_750);
  assert.equal(open.row.rotRut?.stage, "paid_out");
});

test("crediting a ROT invoice: in full only, and only what the customer paid is refunded", async () => {
  const invoice = await rotInvoice({ issueDate: day("2035-02-01"), dueDate: day("2035-02-28") });
  await payInvoice(invoice.id, 19_250, "2035-02-20");

  await assert.rejects(
    createCreditNote(prisma, { businessId, invoiceId: invoice.id, amount: 5_000, issueDate: day("2035-03-01") }),
    (error: unknown) => error instanceof CreditError && error.code === "rot_rut_full_only"
  );

  const result = await createCreditNote(prisma, {
    businessId,
    invoiceId: invoice.id,
    amount: 23_000,
    issueDate: day("2035-03-01"),
    refundPaidOn: day("2035-03-02")
  });
  // Skatteverket's 3 750 was never received, so it is not paid back to anyone.
  assert.equal(result.refundPart, 19_250);
  assert.equal(result.unpaidPart, 3_750);
  assert.ok(result.transaction);
  assert.equal(asNumber(result.transaction.grossAmount), -19_250);

  const balance = await balanceOf(invoice.id, "2035-06-01");
  assert.deepEqual(balance.status, { kind: "CREDITED", remaining: 0, days: 0, overdue: false });
  assert.equal(balance.amounts.pendingRefund, 0);
  // Nothing is left to request from Skatteverket.
  assert.equal(balance.row.rotRut?.stage, "cancelled");
  const queue = await loadRotRutQueue(prisma, { businessId, today: day("2035-06-01") });
  assert.equal(queue.rows.some((row) => row.id === invoice.id), false);
  await assert.rejects(buildRotRutRequestFile(prisma, { businessId, today: day("2035-06-01"), invoiceId: invoice.id }), rejectsWith("not_ready"));
  await assert.rejects(
    registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2035-06-01"), amount: 3_750 }),
    rejectsWith("credited")
  );

  // An unpaid ROT invoice credited in full: nothing booked, nothing owed.
  const unpaid = await rotInvoice({ issueDate: day("2035-02-01"), dueDate: day("2035-02-28") });
  const none = await createCreditNote(prisma, { businessId, invoiceId: unpaid.id, amount: 23_000, issueDate: day("2035-03-01") });
  assert.equal(none.transaction, null);
  assert.equal(none.refundPart, 0);
  assert.equal((await balanceOf(unpaid.id)).status.kind, "CREDITED");
});

test("undoing the customer's payment before the request puts the invoice back to waiting", async () => {
  const invoice = await rotInvoice({ issueDate: day("2036-02-01"), dueDate: day("2036-02-28") });
  await payInvoice(invoice.id, 19_250, "2036-02-20");
  const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(rotRutBlocksPaymentUndo({ ...stored, settledAfterUndo: 0, customerPart: 19_250 }), null);

  // The stamp can be taken back as long as nothing is paid out.
  await markRotRutRequested(prisma, { businessId, invoiceIds: [invoice.id], sent: true });
  await markRotRutRequested(prisma, { businessId, invoiceIds: [invoice.id], sent: false });
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).rotRutRequestedAt, null);
  assert.equal((await balanceOf(invoice.id)).row.rotRut?.stage, "ready");
});

test("ROT and RUT are refused for fakturametoden, without F-skatt, in another currency and for the seller", async () => {
  const count = () => prisma.invoice.count({ where: { businessId } });
  const before = await count();

  await prisma.business.update({ where: { id: businessId }, data: { bookkeepingMethod: "fakturametoden" } });
  try {
    await assert.rejects(prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput())), rejectsWith("accrual"));
    // An ordinary invoice is still fine there.
    const plain = await prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput({ rotRut: null })));
    assert.equal(plain.rotRutType, null);
    assert.equal(plain.items.every((item) => !item.rotRutLabour && item.rotRutWorkType === null), true);
    assert.equal((await balanceOf(plain.id)).amounts.remainingAmount, 23_000);
  } finally {
    await prisma.business.update({ where: { id: businessId }, data: { bookkeepingMethod: "kontantmetoden" } });
  }

  await prisma.business.update({ where: { id: businessId }, data: { fSkattRegistered: false } });
  try {
    await assert.rejects(prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput())), rejectsWith("no_f_skatt"));
  } finally {
    await prisma.business.update({ where: { id: businessId }, data: { fSkattRegistered: true } });
  }

  await assert.rejects(prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput({ currency: "EUR" }))), rejectsWith("currency"));
  await assert.rejects(
    prisma.$transaction((tx) =>
      createInvoiceRecord(tx, rotInput({ rotRut: { type: "ROT", personnummer: SELLER, housing: "property", propertyDesignation: "Eken 12" } }))
    ),
    rejectsWith("buyer_is_seller")
  );
  await assert.rejects(
    prisma.$transaction((tx) =>
      createInvoiceRecord(tx, rotInput({ rotRut: { type: "ROT", personnummer: "19121212-1213", housing: "property", propertyDesignation: "Eken 12" } }))
    ),
    rejectsWith("personnummer_checksum")
  );
  // Nothing was saved by the refused attempts, and no invoice number was used up.
  assert.equal(await count(), before + 1);

  // A payout cannot be booked under fakturametoden either.
  const invoice = await rotInvoice({ issueDate: day("2037-02-01"), dueDate: day("2037-02-28") });
  await payInvoice(invoice.id, 19_250, "2037-02-20");
  await prisma.business.update({ where: { id: businessId }, data: { bookkeepingMethod: "fakturametoden" } });
  try {
    await assert.rejects(
      registerRotRutPayout(prisma, { businessId, invoiceId: invoice.id, paidOn: day("2037-03-01"), amount: 3_750 }),
      rejectsWith("accrual")
    );
  } finally {
    await prisma.business.update({ where: { id: businessId }, data: { bookkeepingMethod: "kontantmetoden" } });
  }
});

// ─── Payment received with a reference ───────────────────────────────────────

test("a payment matched by reference settles only what the customer has left, and reports the excess", async () => {
  // The customer of a ROT invoice pays the whole 23 000 by mistake: only their 19 250 goes on the invoice.
  const rot = await rotInvoice({ issueDate: day("2038-02-01"), dueDate: day("2038-02-28") });
  const paid = await registerPaymentByReference(prisma, {
    businessId,
    reference: rot.invoiceNumber,
    amount: 23_000,
    currency: "SEK",
    paymentDate: day("2038-02-20")
  });
  assert.ok(paid?.ok);
  assert.equal(paid.matched, 19_250);
  assert.equal(paid.excess, 3_750);
  assert.equal(paid.fullyPaid, true);
  assert.equal(asNumber(paid.payment.amount), 19_250);
  assert.equal(paid.payment.transactionId, paid.transaction.id);
  // Skatteverket's part is not booked as received.
  assert.deepEqual(await ledgerLines(paid.transaction.id), { "1930": 19_250, "3001": -15_400, "2610": -3_850 });
  const after = await balanceOf(rot.id);
  assert.equal(after.invoice.status, "PAID");
  assert.equal(after.row.rotRut?.stage, "ready");
  // The payment row gives the request its payment date.
  const loaded = await loadInvoiceForOutput({ businessId, invoiceId: rot.id });
  assert.equal(loaded?.rotRut?.requestCase?.paymentDate, "2038-02-20");
  // Nothing is left, so the same reference no longer matches.
  assert.equal(
    await registerPaymentByReference(prisma, { businessId, reference: rot.invoiceNumber, amount: 100, currency: "SEK", paymentDate: day("2038-02-21") }),
    null
  );

  // An ordinary invoice, found by its OCR reference: a part payment, then too much.
  const plain = await prisma.$transaction((tx) =>
    createInvoiceRecord(tx, rotInput({ rotRut: null, issueDate: day("2038-03-01"), dueDate: day("2038-03-31") }))
  );
  const first = await registerPaymentByReference(prisma, {
    businessId,
    reference: plain.ocrReference,
    amount: 10_000,
    currency: "SEK",
    paymentDate: day("2038-03-10")
  });
  assert.ok(first?.ok);
  assert.equal(first.matched, 10_000);
  assert.equal(first.excess, 0);
  assert.equal(first.remaining, 13_000);
  assert.equal((await balanceOf(plain.id)).invoice.status, "PARTIAL");
  const second = await registerPaymentByReference(prisma, {
    businessId,
    reference: plain.invoiceNumber,
    amount: 20_000,
    currency: "SEK",
    paymentDate: day("2038-03-20")
  });
  assert.ok(second?.ok);
  assert.equal(second.matched, 13_000);
  assert.equal(second.excess, 7_000);
  const settled = await balanceOf(plain.id);
  assert.equal(settled.invoice.status, "PAID");
  assert.equal(settled.amounts.paidAmount, 23_000);
  assert.equal(await prisma.invoicePayment.count({ where: { invoiceId: plain.id } }), 2);

  // Another currency is refused, and an unknown reference matches nothing.
  const euro = await prisma.$transaction((tx) =>
    createInvoiceRecord(tx, rotInput({ rotRut: null, issueDate: day("2038-04-01"), dueDate: day("2038-04-30") }))
  );
  const wrong = await registerPaymentByReference(prisma, { businessId, reference: euro.invoiceNumber, amount: 100, currency: "EUR", paymentDate: day("2038-04-10") });
  assert.equal(wrong?.ok, false);
  assert.equal(await prisma.invoicePayment.count({ where: { invoiceId: euro.id } }), 0);
  assert.equal(
    await registerPaymentByReference(prisma, { businessId, reference: "NO-SUCH-INVOICE", amount: 100, currency: "SEK", paymentDate: day("2038-04-10") }),
    null
  );

  // Paid in one go, an ordinary invoice keeps its own net and VAT and is linked to the entry.
  const whole = await registerInvoicePayment(prisma, { businessId, invoiceId: euro.id, amount: 23_000, paymentDate: day("2038-04-12") });
  assert.equal(asNumber(whole.transaction.netAmount), 18_400);
  assert.equal(asNumber(whole.transaction.vatAmount), 4_600);
  assert.equal(whole.transaction.paidInvoiceId, euro.id);
});

// ─── Year end: income not yet received on 31 December ────────────────────────

test("at year end the customer's debt and Skatteverket's unpaid part are counted separately", async () => {
  // Its own business, so the totals are exactly these invoices.
  const business = await prisma.business.create({
    data: {
      name: "Rot Year-end Firma",
      locale: "sv",
      fiscalYearStart: day("2040-01-01"),
      personnummer: SELLER,
      taxConfig: { create: {} },
      accounts: {
        create: swedishSoleTraderDefaultAccounts.map((a) => ({ code: a.code, name: a.name, type: a.type, vatCode: a.vatCode, isSystem: a.isSystem ?? false }))
      }
    }
  });
  const yearBusinessId = business.id;
  const make = (issue: string, overrides: Partial<CreateInvoiceInput> = {}) =>
    prisma.$transaction((tx) => createInvoiceRecord(tx, rotInput({ businessId: yearBusinessId, issueDate: day(issue), dueDate: null, ...overrides })));
  const pay = (invoiceId: string, amount: number, date: string) =>
    registerInvoicePayment(prisma, { businessId: yearBusinessId, invoiceId, amount, paymentDate: day(date) });
  const payout = (invoiceId: string, amount: number, date: string) =>
    registerRotRutPayout(prisma, { businessId: yearBusinessId, invoiceId, amount, paidOn: day(date) });

  // A: customer paid, Skatteverket has not. Claim 3 750.
  const a = await make("2040-11-01");
  await pay(a.id, 19_250, "2040-11-20");
  // B: nothing paid. Customer 19 250, claim 3 750.
  const b = await make("2040-12-01");
  // C: Skatteverket paid 2 000 of 3 750 in November: the 1 750 is the customer's debt, no claim left.
  const c = await make("2040-10-01");
  await pay(c.id, 19_250, "2040-10-10");
  await payout(c.id, 2_000, "2040-11-01");
  // D: all paid in the year. Nothing.
  const d = await make("2040-09-01");
  await pay(d.id, 19_250, "2040-09-10");
  await payout(d.id, 3_750, "2040-10-01");
  // E: customer paid in December, Skatteverket pays in January (registered further down). Claim 3 750 at year end.
  const e = await make("2040-12-05");
  await pay(e.id, 19_250, "2040-12-10");
  // F: an ordinary invoice, unpaid. 23 000.
  const f = await make("2040-12-15", { rotRut: null });
  // G: a ROT invoice credited in full. Nothing, and no claim.
  const g = await make("2040-12-18");
  await createCreditNote(prisma, { businessId: yearBusinessId, invoiceId: g.id, amount: 23_000, issueDate: day("2040-12-20") });

  // VAT not yet reported, as things stand before E's payout: A 750, B 4 600, C 350, E 750, F 4 600.
  assert.deepEqual(await loadUnreportedInvoiceVat(prisma, { businessId: yearBusinessId, end: day("2040-12-31") }), { count: 5, amount: 11_050 });

  await payout(e.id, 3_750, "2041-01-15");
  assert.deepEqual(await loadUnreportedInvoiceVat(prisma, { businessId: yearBusinessId, end: day("2040-12-31") }), { count: 4, amount: 10_300 });

  // The position on 31 December 2040 does not change because money came in afterwards.
  const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: e.id }, include: invoiceBalanceInclude });
  assert.deepEqual(invoiceOpenAmounts(stored, day("2040-12-31")), { customer: 0, skatteverket: 3_750 });
  assert.deepEqual(invoiceOpenAmounts(stored), { customer: 0, skatteverket: 0 });

  const suggestion = await suggestYearEndReceivables(yearBusinessId, 2040);
  const rows = suggestion.invoices.map((row) => [row.invoiceNumber, row.kind, row.outstanding]).sort();
  assert.deepEqual(
    rows,
    [
      [a.invoiceNumber, "skatteverket", 3_750],
      [b.invoiceNumber, "customer", 19_250],
      [b.invoiceNumber, "skatteverket", 3_750],
      [c.invoiceNumber, "customer", 1_750],
      [e.invoiceNumber, "skatteverket", 3_750],
      [f.invoiceNumber, "customer", 23_000]
    ].sort()
  );
  // Skatteverket's rows say what they are.
  const claim = suggestion.invoices.find((row) => row.invoiceNumber === a.invoiceNumber);
  assert.match(claim?.customerName ?? "", /^Skatteverket: rotavdrag, Kim Kund$/);
  assert.deepEqual(suggestion.totals, { sales25: 44_000 + 11_250, sales12: 0, sales6: 0, sales0: 0 });

  const overview = await buildYearEndOverview(yearBusinessId, 2040, day("2041-02-01"));
  assert.equal(overview.customerInvoices.unpaidCount, 5);
  assert.equal(overview.customerInvoices.unpaidTotal, 55_250);
  assert.equal(overview.customerInvoices.skatteverketCount, 3);
  assert.equal(overview.customerInvoices.skatteverketTotal, 11_250);

  // The next year starts clean except for what is still owed then.
  const next = await suggestYearEndReceivables(yearBusinessId, 2041);
  assert.deepEqual(next.totals, { sales25: 3_750 + 19_250 + 3_750 + 1_750 + 23_000, sales12: 0, sales6: 0, sales0: 0 });
});
