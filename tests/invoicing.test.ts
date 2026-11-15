/**
 * Tests for invoicing: OCR references, payment account validation, invoice
 * status, reminder rules, recurring schedules and quote to invoice.
 *
 * The pure rules need no database. The last tests run against a real
 * PostgreSQL database built from prisma/migrations (see scripts/test.sh).
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { POST as invoiceRemindersCron } from "@/app/api/cron/invoice-reminders/route";
import { GET as recurringInvoicesCronGet, POST as recurringInvoicesCron } from "@/app/api/cron/recurring-invoices/route";
import { prisma } from "@/lib/db";
import { invoiceAmounts } from "@/lib/invoices/balance";
import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { invoiceBalanceInclude, storedStatusFor } from "@/lib/invoices/balance";
import { createCreditNote, CreditError, planCredit, registerRefundPayout } from "@/lib/invoices/credit";
import { createInvoiceRecord } from "@/lib/invoices/create";
import { runInvoiceReminders } from "@/lib/invoices/reminder-run";
import { buildOcrReference, isValidLuhn, isValidOcrReference, luhnCheckDigit, ocrReferenceForInvoice } from "@/lib/invoices/ocr";
import { parseBankgiro, parseBic, parseIban, parsePlusgiro, parseSwish } from "@/lib/invoices/payment-accounts";
import { buildInvoicePdf } from "@/lib/invoices/pdf";
import { convertQuoteToInvoice, effectiveQuoteStatus, QuoteError } from "@/lib/invoices/quotes";
import { advanceRunDate, resolveAnchorDay } from "@/lib/invoices/recurring";
import { runRecurringInvoices, runRecurringTemplate } from "@/lib/invoices/recurring-run";
import { buildReminderMessage, reminderDecision } from "@/lib/invoices/reminders";
import { computeInvoiceStatus, invoiceStatusLabel } from "@/lib/invoices/status";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run invoicing tests against "${dbName}". Use a database whose name ends in _test.`);
}

// No test may ever send a real email: with no provider configured, sending fails cleanly.
for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY"]) delete process.env[key];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

// ─── OCR and check digits ────────────────────────────────────────────────────

test("modulus 10 check digit matches Bankgirot's published examples", () => {
  // Bankgirot, "Beräkning av kontrollsiffra 10-modulen": 991-2346 and 5555-5551.
  assert.equal(luhnCheckDigit("991234"), 6);
  assert.equal(luhnCheckDigit("5555555"), 1);
  // The textbook Luhn example.
  assert.equal(luhnCheckDigit("7992739871"), 3);
  assert.equal(isValidLuhn("79927398713"), true);
  assert.equal(isValidLuhn("79927398710"), false);
  // A sum that is already a multiple of ten gives 0, not 10.
  assert.equal(luhnCheckDigit("12345679"), 0);
});

test("OCR reference carries a length digit and a check digit", () => {
  // Seed 1234567: total length 9, so the length digit is 9, then check digit 0.
  assert.equal(buildOcrReference("1234567"), "123456790");
  // Invoice number INV-2026-0001: digits 20260001, total length 10, length digit 0.
  const ocr = buildOcrReference("INV-2026-0001") as string;
  assert.equal(ocr.slice(0, 8), "20260001");
  assert.equal(ocr.length, 10);
  assert.equal(ocr[8], "0");
  assert.equal(Number(ocr[9]), luhnCheckDigit(ocr.slice(0, 9)));
  assert.equal(isValidOcrReference(ocr), true);

  // One wrong digit, or the right digits at the wrong length, is rejected.
  assert.equal(isValidOcrReference(`${ocr.slice(0, 3)}9${ocr.slice(4)}`), false);
  assert.equal(isValidOcrReference(`1${ocr}`), false);
  assert.equal(isValidOcrReference("12 34"), false);

  // Never longer than Bankgirot's 25 digits, and null without any digits.
  const long = buildOcrReference("9".repeat(40)) as string;
  assert.equal(long.length, 25);
  assert.equal(isValidOcrReference(long), true);
  assert.equal(buildOcrReference("ABC"), null);
});

test("an invoice always gets a unique OCR reference", () => {
  const first = ocrReferenceForInvoice({ invoiceNumber: "INV-2026-0007", fallbackSequence: 7 });
  const second = ocrReferenceForInvoice({
    invoiceNumber: "A-2026-0007",
    fallbackSequence: 8,
    isTaken: (candidate) => candidate === first
  });
  assert.notEqual(first, second);
  assert.equal(isValidOcrReference(second), true);
  // A number without digits falls back to the running number.
  assert.equal(isValidOcrReference(ocrReferenceForInvoice({ invoiceNumber: "FIRST", fallbackSequence: 12 })), true);
});

// ─── Payment accounts ────────────────────────────────────────────────────────

test("bankgiro and plusgiro numbers are checked with modulus 10", () => {
  assert.deepEqual(parseBankgiro("991-2346"), { ok: true, value: "991-2346" });
  assert.deepEqual(parseBankgiro("55555551"), { ok: true, value: "5555-5551" });
  assert.deepEqual(parseBankgiro("900 8004"), { ok: true, value: "900-8004" });
  assert.deepEqual(parseBankgiro("991-2345"), { ok: false, reason: "checksum" });
  assert.deepEqual(parseBankgiro("12345"), { ok: false, reason: "format" });
  assert.deepEqual(parseBankgiro("991-234X"), { ok: false, reason: "format" });

  assert.deepEqual(parsePlusgiro("90 08 00-4"), { ok: true, value: "900800-4" });
  assert.deepEqual(parsePlusgiro("900800-5"), { ok: false, reason: "checksum" });
  assert.deepEqual(parsePlusgiro("123456789"), { ok: false, reason: "format" });
});

test("IBAN is checked with mod 97, BIC and Swish by format", () => {
  assert.deepEqual(parseIban("SE35 5000 0000 0549 1000 0003"), { ok: true, value: "SE3550000000054910000003" });
  assert.equal(parseIban("gb82 west 1234 5698 7654 32").ok, true);
  assert.equal(parseIban("DE89370400440532013000").ok, true);
  assert.deepEqual(parseIban("SE35 5000 0000 0549 1000 0004"), { ok: false, reason: "checksum" });
  assert.deepEqual(parseIban("SE35 5000 0000 0549 1000 000"), { ok: false, reason: "format" });
  assert.deepEqual(parseIban("hello"), { ok: false, reason: "format" });

  assert.deepEqual(parseBic("essesess"), { ok: true, value: "ESSESESS" });
  assert.equal(parseBic("ESSESESSXXX").ok, true);
  assert.equal(parseBic("ESSE").ok, false);

  assert.deepEqual(parseSwish("070-123 45 67"), { ok: true, value: "0701234567" });
  assert.deepEqual(parseSwish("+46 70 123 45 67"), { ok: true, value: "0701234567" });
  assert.deepEqual(parseSwish("123 456 78 90"), { ok: true, value: "1234567890" });
  assert.equal(parseSwish("08-123 456").ok, false);
});

// ─── Status ──────────────────────────────────────────────────────────────────

const statusOf = (overrides: Partial<Parameters<typeof computeInvoiceStatus>[0]> = {}) =>
  computeInvoiceStatus({
    status: "UNPAID",
    grossAmount: 1250,
    paidAmount: 0,
    creditedAmount: 0,
    dueDate: day("2031-05-31"),
    sentAt: day("2031-05-01"),
    today: day("2031-05-21"),
    ...overrides
  });

test("invoice status is computed from the due date and what has been paid", () => {
  assert.deepEqual(statusOf({ sentAt: null }), { kind: "DRAFT", remaining: 1250, days: 0, overdue: false });
  assert.deepEqual(statusOf({ dueDate: null }), { kind: "SENT", remaining: 1250, days: 0, overdue: false });
  assert.deepEqual(statusOf(), { kind: "DUE", remaining: 1250, days: 10, overdue: false });
  assert.equal(statusOf({ today: day("2031-05-31") }).kind, "DUE");
  assert.equal(statusOf({ today: day("2031-05-31") }).days, 0);
  assert.deepEqual(statusOf({ today: day("2031-06-04") }), { kind: "OVERDUE", remaining: 1250, days: 4, overdue: true });

  // Part payment: the balance is what is left, and lateness still shows.
  assert.deepEqual(statusOf({ status: "PARTIAL", paidAmount: 500 }), {
    kind: "PARTLY_PAID",
    remaining: 750,
    days: 0,
    overdue: false
  });
  assert.deepEqual(statusOf({ status: "PARTIAL", paidAmount: 500, today: day("2031-06-10") }), {
    kind: "PARTLY_PAID",
    remaining: 750,
    days: 10,
    overdue: true
  });

  // Paid in full, also long after the due date, and by payment plus credit.
  assert.equal(statusOf({ status: "PAID", paidAmount: 1250, today: day("2031-08-01") }).kind, "PAID");
  assert.equal(statusOf({ paidAmount: 1000, creditedAmount: 250 }).kind, "PAID");
  assert.equal(statusOf({ creditedAmount: 1250 }).kind, "CREDITED");
  assert.equal(statusOf({ status: "VOID" }).kind, "VOID");

  assert.equal(invoiceStatusLabel(statusOf(), "en"), "Due in 10 days");
  assert.equal(invoiceStatusLabel(statusOf({ today: day("2031-06-01") }), "sv"), "Försenad 1 dag");
});

test("a cancelled payment no longer counts, and legacy paid invoices count in full", () => {
  const active = { amount: 500, transaction: { voidedAt: null } };
  const cancelled = { amount: 300, transaction: { voidedAt: new Date() } };
  assert.deepEqual(invoiceAmounts({ status: "PARTIAL", grossAmount: 1250, payments: [active, cancelled], creditNotes: [] }), {
    grossAmount: 1250,
    paidAmount: 500,
    creditedAmount: 0,
    // ROT/RUT: Skatteverket's part of the invoice. Always 0 on an ordinary invoice.
    skatteverketAmount: 0,
    skatteverketReceived: 0,
    remainingAmount: 750,
    pendingRefund: 0
  });
  assert.equal(invoiceAmounts({ status: "PAID", paidAt: day("2031-05-20"), grossAmount: 1250, payments: [], creditNotes: [] }).remainingAmount, 0);
});

// ─── Reminders ───────────────────────────────────────────────────────────────

const reminder = (overrides: Partial<Parameters<typeof reminderDecision>[0]> = {}) =>
  reminderDecision({
    status: "UNPAID",
    remaining: 1250,
    dueDate: day("2031-05-31"),
    sentAt: day("2031-05-01"),
    recipientEmail: "kund@example.se",
    reminderCount: 0,
    lastReminderAt: null,
    today: day("2031-06-07"),
    daysAfterDue: 7,
    ...overrides
  });

test("automatic reminders: after the set days, then weekly, three at most", () => {
  assert.deepEqual(reminder({ today: day("2031-06-06") }), { due: false, reason: "not_overdue_enough" });
  assert.deepEqual(reminder(), { due: true });

  // At most once every seven days.
  assert.deepEqual(reminder({ reminderCount: 1, lastReminderAt: day("2031-06-07"), today: day("2031-06-13") }), {
    due: false,
    reason: "too_soon"
  });
  assert.deepEqual(reminder({ reminderCount: 1, lastReminderAt: day("2031-06-07"), today: day("2031-06-14") }), {
    due: true
  });

  // Never more than three.
  assert.deepEqual(reminder({ reminderCount: 3, lastReminderAt: day("2031-06-21"), today: day("2031-08-01") }), {
    due: false,
    reason: "max_reached"
  });

  // Nothing to remind about, or nobody to remind.
  assert.deepEqual(reminder({ status: "PAID" }), { due: false, reason: "settled" });
  assert.deepEqual(reminder({ remaining: 0 }), { due: false, reason: "settled" });
  assert.deepEqual(reminder({ sentAt: null }), { due: false, reason: "not_sent" });
  assert.deepEqual(reminder({ recipientEmail: " " }), { due: false, reason: "no_email" });
  assert.deepEqual(reminder({ dueDate: null }), { due: false, reason: "no_due_date" });
  // A part-paid invoice is still reminded about.
  assert.deepEqual(reminder({ status: "PARTIAL", remaining: 400 }), { due: true });
});

test("the reminder text is polite, names the amount and never adds a fee", () => {
  for (const locale of ["sv", "en"] as const) {
    const message = buildReminderMessage({
      locale,
      senderName: "Anna Berg Konsult",
      customerName: "Kund AB",
      invoiceNumber: "INV-2031-0004",
      amount: "1 250,00 kr",
      dueDate: "2031-05-31",
      daysOverdue: 7,
      reminderNumber: 1,
      paymentLines: [{ label: "Bankgiro", value: "991-2346" }],
      ocrReference: "20310004" + "0" + luhnCheckDigit("203100040")
    });
    assert.match(message.subject, /INV-2031-0004/);
    assert.match(message.body, /1 250,00 kr/);
    assert.match(message.body, /Bankgiro: 991-2346/);
    assert.doesNotMatch(message.body, /avgift|\bfee\b|ränta|interest/i);
    assert.doesNotMatch(`${message.subject}${message.body}`, /—/);
  }
});

// ─── Recurring schedule ──────────────────────────────────────────────────────

test("a monthly schedule on the 31st follows the month ends", () => {
  const feb = advanceRunDate(day("2031-01-31"), "MONTHLY", 31);
  assert.equal(iso(feb), "2031-02-28");
  assert.equal(iso(advanceRunDate(feb, "MONTHLY", 31)), "2031-03-31");
  assert.equal(iso(advanceRunDate(day("2031-03-31"), "MONTHLY", 31)), "2031-04-30");

  // Leap year.
  const leapFeb = advanceRunDate(day("2032-01-31"), "MONTHLY", 31);
  assert.equal(iso(leapFeb), "2032-02-29");
  assert.equal(iso(advanceRunDate(leapFeb, "MONTHLY", 31)), "2032-03-31");

  // The anchor is recovered from earlier invoices when a short month clamped the date.
  assert.equal(resolveAnchorDay(day("2031-02-28"), [31]), 31);
  assert.equal(resolveAnchorDay(day("2031-02-28"), [30]), 30);
  assert.equal(resolveAnchorDay(day("2031-02-28"), []), 28);
  assert.equal(resolveAnchorDay(day("2031-03-15"), [31]), 15);
  assert.equal(iso(advanceRunDate(day("2031-02-28"), "MONTHLY", resolveAnchorDay(day("2031-02-28"), [30]))), "2031-03-30");
});

test("quarterly and yearly schedules, across year ends and leap days", () => {
  assert.equal(iso(advanceRunDate(day("2031-11-30"), "QUARTERLY")), "2032-02-29");
  assert.equal(iso(advanceRunDate(day("2031-11-15"), "QUARTERLY")), "2032-02-15");
  assert.equal(iso(advanceRunDate(day("2031-12-01"), "MONTHLY")), "2032-01-01");
  assert.equal(iso(advanceRunDate(day("2032-02-29"), "YEARLY")), "2033-02-28");
  assert.equal(iso(advanceRunDate(day("2031-06-10"), "YEARLY")), "2032-06-10");
});

// ─── PDF ─────────────────────────────────────────────────────────────────────

test("the invoice PDF shows how to pay, in the business language", () => {
  const pdf = buildInvoicePdf({
    invoiceNumber: "INV-2031-0001",
    issueDate: day("2031-05-01"),
    dueDate: day("2031-05-31"),
    currency: "SEK",
    sender: { name: "Åsa Öberg Snickeri", registration: "850101-1234" },
    customer: { name: "Kund AB", address: "Storgatan 1, 111 22 Stockholm" },
    items: [{ description: "Köksrenovering", quantity: 1, unitPrice: 1000, netAmount: 1000, vatAmount: 250, totalAmount: 1250, vatRate: 0.25 }],
    subtotalAmount: 1000,
    vatAmount: 250,
    grossAmount: 1250,
    locale: "sv",
    ocrReference: "123456790",
    paymentAccounts: { bankgiro: "991-2346", swishNumber: "1234567890" },
    fSkattRegistered: true
  }).toString("latin1");

  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\(FAKTURA\)/);
  assert.match(pdf, /\(Bankgiro\)/);
  assert.match(pdf, /\(991-2346\)/);
  assert.match(pdf, /\(123456790\)/);
  assert.match(pdf, /\(Swish\)/);
  assert.match(pdf, /2031-05-31/);
  // Swedish letters are written in WinAnsi (å = octal 345), not replaced with "?".
  assert.match(pdf, /S\\345 h\\344r betalar du/);
  assert.match(pdf, /\(\\305sa \\326berg Snickeri\)/);
});

// ─── Database: quote to invoice, recurring invoices ──────────────────────────

let businessId = "";
let customerId = "";

before(async () => {
  const business = await prisma.business.create({
    data: {
      name: "Invoicing Test Firma",
      fiscalYearStart: day("2031-01-01"),
      defaultPaymentTermsDays: 20,
      customers: { create: { name: "Kund AB", email: "kund@example.se" } }
    },
    include: { customers: true }
  });
  businessId = business.id;
  customerId = business.customers[0].id;
});

after(async () => {
  await prisma.$disconnect();
});

const quoteLines = [
  { description: "Design", quantity: 10, unitPrice: 800, vatMode: "EXCLUSIVE" as const, vatRate: 0.25 },
  { description: "Tryck", quantity: 2, unitPrice: 530, vatMode: "INCLUSIVE" as const, vatRate: 0.06 },
  { description: "Resa", quantity: 1, unitPrice: 150, vatMode: "NO_VAT" as const, vatRate: 0 }
];

const createQuote = async (number: string, status = "SENT") => {
  const computed = computeInvoiceTotals(quoteLines);
  return prisma.quote.create({
    data: {
      businessId,
      customerId,
      quoteNumber: number,
      customerName: "Kund AB",
      customerEmail: "kund@example.se",
      customerAddress: "Storgatan 1, 111 22 Stockholm",
      projectName: "Ny webbplats",
      issueDate: day("2031-04-01"),
      validUntil: day("2031-04-30"),
      status,
      subtotalAmount: computed.subtotal,
      vatAmount: computed.vatAmount,
      grossAmount: computed.grossAmount,
      items: { create: computed.items.map((item, index) => ({ sortOrder: index, ...item })) }
    },
    include: { items: { orderBy: { sortOrder: "asc" } } }
  });
};

test("a quote past its valid until date counts as expired, but an accepted one does not", () => {
  const validUntil = day("2031-04-30");
  assert.equal(effectiveQuoteStatus({ status: "SENT", validUntil }, day("2031-04-30")), "SENT");
  assert.equal(effectiveQuoteStatus({ status: "SENT", validUntil }, day("2031-05-01")), "EXPIRED");
  assert.equal(effectiveQuoteStatus({ status: "DRAFT", validUntil }, day("2031-05-01")), "EXPIRED");
  assert.equal(effectiveQuoteStatus({ status: "ACCEPTED", validUntil }, day("2031-05-01")), "ACCEPTED");
  assert.equal(effectiveQuoteStatus({ status: "INVOICED", validUntil }, day("2031-05-01")), "INVOICED");
  assert.equal(effectiveQuoteStatus({ status: "SENT", validUntil: null }, day("2031-05-01")), "SENT");
});

test("turning a quote into an invoice copies lines and totals, links both and posts nothing", async () => {
  const quote = await createQuote("OFF-2031-0001");
  const ledgerBefore = await prisma.transaction.count({ where: { businessId } });

  const invoice = await convertQuoteToInvoice(prisma, { businessId, quoteId: quote.id, today: day("2031-04-10") });

  assert.equal(invoice.items.length, 3);
  invoice.items.forEach((item, index) => {
    const source = quote.items[index];
    assert.equal(item.description, source.description);
    assert.equal(item.quantity.toString(), source.quantity.toString());
    assert.equal(item.unitPrice.toString(), source.unitPrice.toString());
    assert.equal(item.vatMode, source.vatMode);
    assert.equal(item.netAmount.toString(), source.netAmount.toString());
    assert.equal(item.vatAmount.toString(), source.vatAmount.toString());
    assert.equal(item.totalAmount.toString(), source.totalAmount.toString());
  });
  assert.equal(invoice.subtotalAmount.toString(), quote.subtotalAmount.toString());
  assert.equal(invoice.vatAmount.toString(), quote.vatAmount.toString());
  assert.equal(invoice.grossAmount.toString(), quote.grossAmount.toString());
  assert.equal(Number(invoice.grossAmount), 11210);

  assert.equal(invoice.customerId, customerId);
  assert.equal(invoice.customerName, "Kund AB");
  assert.equal(invoice.status, "UNPAID");
  assert.equal(iso(invoice.issueDate), "2031-04-10");
  // Due date from the business payment terms (20 days), OCR reference set and valid.
  assert.equal(iso(invoice.dueDate as Date), "2031-04-30");
  assert.equal(isValidOcrReference(invoice.ocrReference as string), true);

  const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
  assert.equal(after.status, "INVOICED");
  assert.equal(after.invoiceId, invoice.id);

  // A quote is not a bookkeeping record, and neither is an unpaid invoice under kontantmetoden.
  assert.equal(await prisma.transaction.count({ where: { businessId } }), ledgerBefore);
});

test("a quote cannot be turned into an invoice twice", async () => {
  const quote = await createQuote("OFF-2031-0002");
  const input = { businessId, quoteId: quote.id, today: day("2031-04-11") };

  await convertQuoteToInvoice(prisma, input);
  await assert.rejects(convertQuoteToInvoice(prisma, input), QuoteError);

  // Two requests at the same moment: exactly one wins.
  const racing = await createQuote("OFF-2031-0003");
  const outcomes = await Promise.allSettled([
    convertQuoteToInvoice(prisma, { ...input, quoteId: racing.id }),
    convertQuoteToInvoice(prisma, { ...input, quoteId: racing.id })
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);

  const invoices = await prisma.invoice.findMany({ where: { businessId }, select: { invoiceNumber: true, ocrReference: true } });
  assert.equal(invoices.length, 3);
  assert.equal(new Set(invoices.map((row) => row.invoiceNumber)).size, 3);
  assert.equal(new Set(invoices.map((row) => row.ocrReference)).size, 3);

  // Declined quotes and other businesses' quotes are refused.
  const declined = await createQuote("OFF-2031-0004", "DECLINED");
  await assert.rejects(convertQuoteToInvoice(prisma, { ...input, quoteId: declined.id }), QuoteError);
  await assert.rejects(convertQuoteToInvoice(prisma, { ...input, businessId: "someone-else" }), QuoteError);
});

test("the recurring job creates each invoice once and advances the schedule", async () => {
  const template = await prisma.recurringInvoice.create({
    data: {
      businessId,
      customerId,
      customerName: "Kund AB",
      customerEmail: "kund@example.se",
      description: "Månadsavtal",
      itemsJson: JSON.stringify([{ description: "Support", quantity: 1, unitPrice: 2000, vatMode: "EXCLUSIVE", vatRate: 0.25 }]),
      frequency: "MONTHLY",
      nextRunDate: day("2031-01-31"),
      endDate: day("2031-03-31"),
      paymentTermsDays: 15,
      autoSend: false
    }
  });
  const count = () => prisma.invoice.count({ where: { recurringInvoiceId: template.id } });
  const state = () => prisma.recurringInvoice.findUniqueOrThrow({ where: { id: template.id } });

  // Not due yet.
  assert.equal(await runRecurringTemplate(prisma, template.id, day("2031-01-30")), null);
  assert.equal(await count(), 0);

  // Due: one invoice, numbered in the normal series, due after the template's terms.
  const first = await runRecurringInvoices(prisma, { today: day("2031-01-31"), businessId });
  assert.equal(first.length, 1);
  assert.equal(first[0].error, undefined);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: first[0].invoiceId as string }, include: { items: true } });
  assert.match(invoice.invoiceNumber, /^INV-2031-\d{4}$/);
  assert.equal(iso(invoice.issueDate), "2031-01-31");
  assert.equal(iso(invoice.dueDate as Date), "2031-02-15");
  assert.equal(Number(invoice.grossAmount), 2500);
  assert.equal(invoice.items.length, 1);
  assert.equal(iso((await state()).nextRunDate), "2031-02-28");

  // Running again the same day, or twice at once, creates nothing more.
  assert.equal((await runRecurringInvoices(prisma, { today: day("2031-01-31"), businessId })).length, 0);
  const racing = await Promise.all([
    runRecurringTemplate(prisma, template.id, day("2031-02-28")),
    runRecurringTemplate(prisma, template.id, day("2031-02-28"))
  ]);
  assert.equal(racing.filter(Boolean).length, 1);
  assert.equal(await count(), 2);
  // 31 Jan, 28 Feb, then back to the 31st.
  assert.equal(iso((await state()).nextRunDate), "2031-03-31");

  // Far behind: one period per run, and the end date stops the template.
  await runRecurringInvoices(prisma, { today: day("2031-07-01"), businessId });
  assert.equal(await count(), 3);
  const ended = await state();
  assert.equal(ended.active, false);
  assert.equal((await runRecurringInvoices(prisma, { today: day("2031-07-02"), businessId })).length, 0);
  assert.equal(await count(), 3);

  // The invoice numbers are an unbroken series with no duplicates.
  const numbers = (await prisma.invoice.findMany({ where: { businessId }, select: { invoiceNumber: true } })).map(
    (row) => row.invoiceNumber
  );
  assert.equal(new Set(numbers).size, numbers.length);
});

// ─── Database: automatic reminders and the cron routes ───────────────────────

test("the reminder job picks only eligible invoices and gives the reminder back when sending fails", async () => {
  const other = await prisma.business.create({
    data: { name: "Reminder Test Firma", fiscalYearStart: day("2031-01-01"), invoiceReminderEnabled: true, invoiceReminderDaysAfterDue: 5 }
  });
  const make = (overrides: { dueDate: Date; sentAt: Date | null; email?: string | null }) =>
    prisma.$transaction((tx) =>
      createInvoiceRecord(tx, {
        businessId: other.id,
        customer: { name: "Sen Kund AB", email: overrides.email === undefined ? "sen@example.se" : overrides.email },
        items: [{ description: "Arbete", quantity: 1, unitPrice: 1000, vatMode: "EXCLUSIVE", vatRate: 0.25 }],
        issueDate: day("2031-05-01"),
        dueDate: overrides.dueDate,
        emailTo: overrides.email === undefined ? "sen@example.se" : overrides.email
      }).then(async (invoice) => {
        await tx.invoice.update({ where: { id: invoice.id }, data: { sentAt: overrides.sentAt } });
        return invoice;
      })
    );

  const late = await make({ dueDate: day("2031-05-31"), sentAt: day("2031-05-01") });
  await make({ dueDate: day("2031-06-03"), sentAt: day("2031-05-01") }); // only 4 days late
  await make({ dueDate: day("2031-05-31"), sentAt: null }); // never sent
  const noEmail = await make({ dueDate: day("2031-05-31"), sentAt: day("2031-05-01"), email: null });

  const results = (await runInvoiceReminders(prisma, { today: day("2031-06-07") })).filter(
    (result) => result.businessId === other.id
  );
  // Only invoices that are late enough and were sent are looked at; the one without an address is skipped.
  assert.deepEqual(results.map((result) => result.invoiceId).sort(), [late.id, noEmail.id].sort());
  assert.equal(results.find((result) => result.invoiceId === noEmail.id)?.reason, "no_email");

  // Email is not configured in tests, so the send fails: nothing may be counted as sent.
  const attempted = results.find((result) => result.invoiceId === late.id);
  assert.equal(attempted?.sent, false);
  assert.match(attempted?.error ?? "", /not configured/i);
  const after = await prisma.invoice.findUniqueOrThrow({ where: { id: late.id } });
  assert.equal(after.reminderCount, 0);
  assert.equal(after.lastReminderAt, null);

  // A business with automatic reminders off is never touched.
  await prisma.business.update({ where: { id: other.id }, data: { invoiceReminderEnabled: false } });
  const off = await runInvoiceReminders(prisma, { today: day("2031-06-07") });
  assert.equal(off.filter((result) => result.businessId === other.id).length, 0);
});

test("the cron routes refuse to run without CRON_SECRET and reject a wrong token", async () => {
  const call = (handler: (request: Request) => Promise<Response>, token?: string) =>
    handler(
      new Request("http://localhost/api/cron/x", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {}
      })
    );

  delete process.env.CRON_SECRET;
  assert.equal((await call(recurringInvoicesCron, "anything")).status, 503);
  assert.equal((await call(invoiceRemindersCron, "anything")).status, 503);

  process.env.CRON_SECRET = "test-cron-secret";
  try {
    assert.equal((await call(recurringInvoicesCron)).status, 401);
    assert.equal((await call(recurringInvoicesCron, "wrong")).status, 401);
    assert.equal((await call(invoiceRemindersCron, "test-cron-secret-and-more")).status, 401);

    const ok = await call(recurringInvoicesCron, "test-cron-secret");
    assert.equal(ok.status, 200);
    assert.equal(typeof ((await ok.json()) as { created: number }).created, "number");
    // Vercel Cron calls with GET.
    assert.equal((await call(recurringInvoicesCronGet, "test-cron-secret")).status, 200);
    assert.equal((await call(invoiceRemindersCron, "test-cron-secret")).status, 200);
  } finally {
    delete process.env.CRON_SECRET;
  }
});

// ─── Database: credit notes book only money that moves ───────────────────────

let creditBusinessId = "";

const creditSetup = async () => {
  if (creditBusinessId) return creditBusinessId;
  const business = await prisma.business.create({
    data: {
      name: "Credit Test Firma",
      fiscalYearStart: day("2031-01-01"),
      invoiceReminderEnabled: true,
      invoiceReminderDaysAfterDue: 5,
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
  creditBusinessId = business.id;
  return creditBusinessId;
};

/** A sent invoice of 1 250 kr (1 000 + 25 % VAT), due 31 May 2031. */
const sentInvoice = async () => {
  const id = await creditSetup();
  const invoice = await prisma.$transaction((tx) =>
    createInvoiceRecord(tx, {
      businessId: id,
      customer: { name: "Kreditkund AB", email: "kredit@example.se" },
      items: [{ description: "Arbete", quantity: 1, unitPrice: 1000, vatMode: "EXCLUSIVE", vatRate: 0.25 }],
      issueDate: day("2031-05-01"),
      dueDate: day("2031-05-31"),
      emailTo: "kredit@example.se"
    })
  );
  await prisma.invoice.update({ where: { id: invoice.id }, data: { sentAt: day("2031-05-01") } });
  return invoice;
};

/** Registers a payment the way the partial-pay route does. */
const payInvoice = async (invoiceId: string, amount: number, date: string) => {
  const transaction = await createTransaction({
    businessId: creditBusinessId,
    txnDate: day(date),
    description: "Payment",
    direction: TransactionDirections.INCOME,
    grossAmount: amount,
    vatRate: 0.25,
    source: EntrySources.INVOICE_PAYMENT,
    incomeAccountCode: "3001"
  });
  await prisma.invoicePayment.create({
    data: { businessId: creditBusinessId, invoiceId, transactionId: transaction.id, paymentDate: day(date), amount }
  });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceBalanceInclude });
  const status = storedStatusFor(invoiceAmounts({ ...invoice, status: "UNPAID" }));
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status, paidAt: status === "PAID" ? day(date) : null } });
};

const balanceOf = async (invoiceId: string, today = "2031-06-20") => {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceBalanceInclude });
  const amounts = invoiceAmounts(invoice);
  return {
    stored: invoice.status,
    amounts,
    status: computeInvoiceStatus({ status: invoice.status, ...amounts, dueDate: invoice.dueDate, sentAt: invoice.sentAt, today: day(today) })
  };
};

const ledgerCount = () => prisma.transaction.count({ where: { businessId: creditBusinessId } });

test("a credit splits into the part never paid and the part to pay back", () => {
  assert.deepEqual(planCredit(1250, 1250), { unpaidPart: 1250, refundPart: 0 });
  assert.deepEqual(planCredit(1250, 750), { unpaidPart: 750, refundPart: 500 });
  assert.deepEqual(planCredit(300, 0), { unpaidPart: 0, refundPart: 300 });
  assert.deepEqual(planCredit(200, 750), { unpaidPart: 200, refundPart: 0 });
});

test("crediting an unpaid invoice posts nothing and nets the balance to zero", async () => {
  const invoice = await sentInvoice();
  const before = await ledgerCount();

  const result = await createCreditNote(prisma, {
    businessId: creditBusinessId,
    invoiceId: invoice.id,
    amount: 1250,
    issueDate: day("2031-06-10"),
    reason: "Fel pris",
    // Even if a payout date is sent, there is nothing to pay back, so nothing is booked.
    refundPaidOn: day("2031-06-10")
  });

  assert.equal(result.transaction, null);
  assert.equal(result.creditNote.transactionId, null);
  assert.equal(result.refundPart, 0);
  assert.equal(result.remaining, 0);
  assert.equal(await ledgerCount(), before);

  // Long past the due date, it shows as credited: not overdue, nothing to pay, nothing to refund.
  const balance = await balanceOf(invoice.id, "2031-09-01");
  assert.deepEqual(balance.status, { kind: "CREDITED", remaining: 0, days: 0, overdue: false });
  assert.equal(balance.amounts.pendingRefund, 0);
  assert.equal(invoiceStatusLabel(balance.status, "en"), "Credited");

  // It cannot be credited again.
  await assert.rejects(
    createCreditNote(prisma, { businessId: creditBusinessId, invoiceId: invoice.id, amount: 1, issueDate: day("2031-06-11") }),
    CreditError
  );
});

test("a part credit of an unpaid invoice posts nothing and leaves the rest to pay", async () => {
  const invoice = await sentInvoice();
  const before = await ledgerCount();
  await createCreditNote(prisma, { businessId: creditBusinessId, invoiceId: invoice.id, amount: 250, issueDate: day("2031-05-10") });
  assert.equal(await ledgerCount(), before);
  const balance = await balanceOf(invoice.id);
  assert.equal(balance.status.remaining, 1000);
  assert.equal(balance.status.overdue, true);
  assert.equal(balance.stored, "PARTIAL");
  // More than the invoice amount can never be credited.
  await assert.rejects(
    createCreditNote(prisma, { businessId: creditBusinessId, invoiceId: invoice.id, amount: 1000.5, issueDate: day("2031-05-11") }),
    CreditError
  );
});

test("crediting a paid invoice posts the refund on the day it is paid out", async () => {
  const invoice = await sentInvoice();
  await payInvoice(invoice.id, 1250, "2031-05-20");
  const before = await ledgerCount();

  const result = await createCreditNote(prisma, {
    businessId: creditBusinessId,
    invoiceId: invoice.id,
    amount: 1250,
    issueDate: day("2031-06-10"),
    refundPaidOn: day("2031-06-12")
  });

  assert.equal(await ledgerCount(), before + 1);
  assert.equal(result.refundPart, 1250);
  assert.equal(result.pendingRefund, 0);
  const transaction = await prisma.transaction.findUniqueOrThrow({
    where: { id: result.creditNote.transactionId as string },
    include: { lines: { include: { account: true } } }
  });
  // A refund is negative sales: direction INCOME with negative amounts.
  assert.equal(Number(transaction.grossAmount), -1250);
  assert.equal(transaction.direction, "INCOME");
  assert.equal(Number(transaction.vatAmount), -250);
  assert.equal(iso(transaction.txnDate), "2031-06-12");
  // Income and output VAT reversed against the bank account.
  const line = (code: string) => transaction.lines.find((row) => row.account.code === code);
  assert.equal(Number(line("3001")?.debit), 1000);
  assert.equal(Number(line("2610")?.debit), 250);
  assert.equal(Number(line("1930")?.credit), 1250);

  const balance = await balanceOf(invoice.id);
  assert.equal(balance.status.kind, "CREDITED");
  assert.equal(balance.amounts.pendingRefund, 0);
});

test("a refund not yet paid out is recorded now and booked when it is registered", async () => {
  const invoice = await sentInvoice();
  await payInvoice(invoice.id, 1250, "2031-05-20");
  const before = await ledgerCount();

  const result = await createCreditNote(prisma, {
    businessId: creditBusinessId,
    invoiceId: invoice.id,
    amount: 400,
    issueDate: day("2031-06-10")
  });
  assert.equal(result.transaction, null);
  assert.equal(result.pendingRefund, 400);
  assert.equal(await ledgerCount(), before);
  assert.equal((await balanceOf(invoice.id)).amounts.pendingRefund, 400);

  const payout = await registerRefundPayout(prisma, { businessId: creditBusinessId, invoiceId: invoice.id, paidOn: day("2031-06-18") });
  assert.equal(payout.refunded, 400);
  assert.equal(await ledgerCount(), before + 1);
  assert.equal(iso(payout.transactions[0].txnDate), "2031-06-18");
  assert.equal(Number(payout.transactions[0].grossAmount), -400);
  assert.equal((await balanceOf(invoice.id)).amounts.pendingRefund, 0);

  // Nothing is left to pay out, so it cannot be booked twice.
  await assert.rejects(
    registerRefundPayout(prisma, { businessId: creditBusinessId, invoiceId: invoice.id, paidOn: day("2031-06-19") }),
    CreditError
  );
  assert.equal(await ledgerCount(), before + 1);
});

test("part payment then full credit posts only the paid part", async () => {
  const invoice = await sentInvoice();
  await payInvoice(invoice.id, 500, "2031-05-20");
  const before = await ledgerCount();

  const result = await createCreditNote(prisma, {
    businessId: creditBusinessId,
    invoiceId: invoice.id,
    amount: 1250,
    issueDate: day("2031-06-10"),
    refundPaidOn: day("2031-06-10")
  });

  assert.equal(result.unpaidPart, 750);
  assert.equal(result.refundPart, 500);
  assert.equal(await ledgerCount(), before + 1);
  assert.equal(Number(result.transaction?.grossAmount), -500);
  assert.equal(Number(result.transaction?.netAmount), -400);
  assert.equal(Number(result.creditNote.amount), 1250);

  const balance = await balanceOf(invoice.id);
  assert.equal(balance.status.kind, "CREDITED");
  assert.equal(balance.status.remaining, 0);
  assert.equal(balance.amounts.pendingRefund, 0);
});

test("reminders skip a fully credited invoice", async () => {
  const credited = await sentInvoice();
  const stillOwed = await sentInvoice();
  await createCreditNote(prisma, { businessId: creditBusinessId, invoiceId: credited.id, amount: 1250, issueDate: day("2031-06-01") });

  const results = (await runInvoiceReminders(prisma, { today: day("2031-06-20") })).filter(
    (result) => result.businessId === creditBusinessId
  );
  const ids = results.map((result) => result.invoiceId);
  assert.equal(ids.includes(credited.id), false);
  assert.equal(ids.includes(stillOwed.id), true);

  // The rule itself says the same, whatever the stored status.
  const balance = await balanceOf(credited.id);
  assert.deepEqual(
    reminderDecision({
      status: "UNPAID",
      remaining: balance.status.remaining,
      dueDate: day("2031-05-31"),
      sentAt: day("2031-05-01"),
      recipientEmail: "kredit@example.se",
      reminderCount: 0,
      lastReminderAt: null,
      today: day("2031-06-20"),
      daysAfterDue: 5
    }),
    { due: false, reason: "settled" }
  );
  const after = await prisma.invoice.findUniqueOrThrow({ where: { id: credited.id } });
  assert.equal(after.reminderCount, 0);
});
