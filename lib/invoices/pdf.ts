/**
 * Invoice and quote PDFs. The text follows the business language, and an
 * invoice ends with a "how to pay" block: amount, due date, the accounts the
 * business has set, and the OCR reference.
 */

import { round2 } from "@/lib/accounting/math";
import { type PaymentAccounts, paymentAccountLines } from "@/lib/invoices/payment-accounts";
import { PAGE_HEIGHT, PAGE_WIDTH, PdfDocument, type Rgb, wrapText } from "@/lib/invoices/pdf-core";

type PdfLocale = "sv" | "en";

type PdfParty = {
  name?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  registration?: string | null;
};

type PdfItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatAmount: number;
  totalAmount: number;
  /** Line amount without VAT. Left out: total minus VAT. */
  netAmount?: number;
  /** 0.25 for 25 %. Left out: derived from the amounts. */
  vatRate?: number;
};

export type InvoicePdfInput = {
  invoiceNumber: string;
  projectName?: string | null;
  issueDate: Date;
  dueDate?: Date | null;
  currency: string;
  sender: PdfParty;
  customer: PdfParty;
  items: PdfItem[];
  subtotalAmount: number;
  vatAmount: number;
  grossAmount: number;
  notes?: string | null;
  paymentMethod?: string | null;
  paymentDetails?: string | null;
  locale?: PdfLocale;
  ocrReference?: string | null;
  paymentAccounts?: PaymentAccounts;
  paidAmount?: number;
  creditedAmount?: number;
  vatNumber?: string | null;
  fSkattRegistered?: boolean;
  /** ROT or RUT: the customer pays the total minus the preliminary tax reduction. */
  rotRut?: {
    type: "ROT" | "RUT";
    /** 0.3 for 30 %. */
    rate: number;
    /** Each including VAT. */
    labourAmount: number;
    materialAmount: number;
    otherAmount: number;
    /** The preliminary reduction, requested from Skatteverket. */
    deduction: number;
    /** What Skatteverket paid, once known. Less than the reduction: the customer owes the difference. */
    approvedAmount?: number | null;
    /** The buyer's personnummer, formatted. */
    personnummer: string;
    /** Property designation, or housing society and apartment. Empty for RUT. */
    property?: string;
    works: { label: string; hours: number }[];
  };
};

export type QuotePdfInput = {
  quoteNumber: string;
  projectName?: string | null;
  issueDate: Date;
  validUntil?: Date | null;
  currency: string;
  sender: PdfParty;
  customer: PdfParty;
  items: PdfItem[];
  subtotalAmount: number;
  vatAmount: number;
  grossAmount: number;
  description?: string | null;
  notes?: string | null;
  locale?: PdfLocale;
  vatNumber?: string | null;
  fSkattRegistered?: boolean;
};

const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;
const BOTTOM = PAGE_HEIGHT - 70;
const INK: Rgb = [0.1, 0.11, 0.12];
const PRIMARY: Rgb = [0.21, 0.26, 0.27];
const MUTED: Rgb = [0.42, 0.45, 0.46];
const TINT: Rgb = [0.955, 0.952, 0.94];

const moneyFormatter = (currency: string, locale: PdfLocale) => {
  const normalized = currency.trim().toUpperCase();
  const safeCurrency = /^[A-Z]{3}$/.test(normalized) ? normalized : "SEK";
  const format = new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return (value: number) => format.format(value);
};

const formatDate = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "-");

const formatQuantity = (value: number, locale: PdfLocale) =>
  new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 4 }).format(value);

const formatPercent = (rate: number, locale: PdfLocale) =>
  `${new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 2 }).format(rate * 100)} %`;

const itemNet = (item: PdfItem) => item.netAmount ?? round2(item.totalAmount - item.vatAmount);

const itemRate = (item: PdfItem) => {
  if (item.vatRate !== undefined) return item.vatRate;
  const net = itemNet(item);
  return net > 0 ? Math.round((item.vatAmount / net) * 100) / 100 : 0;
};

const partyLines = (party: PdfParty) =>
  [party.address, party.email, party.phone, party.website]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

type DocumentInput = {
  kind: "invoice" | "quote";
  locale: PdfLocale;
  title: string;
  number: string;
  sender: PdfParty;
  customer: PdfParty;
  meta: { label: string; value: string }[];
  intro?: string | null;
  items: PdfItem[];
  currency: string;
  subtotalAmount: number;
  vatAmount: number;
  grossAmount: number;
  extraTotals: { label: string; value: string; bold?: boolean }[];
  /** Label of the total row. Left out: "Total to pay" on an invoice. */
  grossLabel?: string;
  /** Paragraphs under the totals (the ROT/RUT statement). */
  infoLines?: string[];
  notes?: string | null;
  payment?: {
    title: string;
    amountLabel: string;
    amount: string;
    dueLabel: string;
    due: string;
    lines: { label: string; value: string }[];
    freeText: string[];
  };
  closing: string[];
  footer: string[];
};

const renderDocument = (input: DocumentInput): Buffer => {
  const sv = input.locale === "sv";
  const doc = new PdfDocument();
  const money = moneyFormatter(input.currency, input.locale);
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed <= BOTTOM) return;
    doc.addPage();
    y = MARGIN + 10;
  };

  // Header: who it is from, and what it is.
  doc.text(input.sender.name?.trim() || "-", MARGIN, y + 14, { size: 15, bold: true, color: PRIMARY });
  doc.text(input.title, RIGHT, y + 16, { size: 20, bold: true, align: "right", color: PRIMARY });
  doc.text(input.number, RIGHT, y + 32, { size: 10, align: "right", color: MUTED });
  y += 62;

  // Customer on the left, key facts on the right.
  const blockTop = y;
  doc.text(sv ? "TILL" : "TO", MARGIN, y, { size: 7.5, bold: true, color: MUTED });
  y += 14;
  doc.text(input.customer.name?.trim() || "-", MARGIN, y, { size: 11, bold: true });
  y += 14;
  for (const line of partyLines(input.customer).flatMap((value) => wrapText(value, 250, 9.5))) {
    doc.text(line, MARGIN, y, { size: 9.5 });
    y += 12.5;
  }

  let metaY = blockTop;
  for (const row of input.meta) {
    doc.text(row.label, 350, metaY + 1, { size: 9, color: MUTED });
    doc.text(row.value, RIGHT, metaY + 1, { size: 9.5, bold: true, align: "right" });
    metaY += 15;
  }
  y = Math.max(y, metaY) + 18;

  if (input.intro?.trim()) {
    for (const line of wrapText(input.intro.trim(), RIGHT - MARGIN, 10)) {
      ensureSpace(14);
      doc.text(line, MARGIN, y, { size: 10 });
      y += 13.5;
    }
    y += 8;
  }

  // Line items.
  const columns = { quantity: 318, unit: 400, vat: 444, amount: RIGHT - 8 };
  const tableHeader = () => {
    doc.rect(MARGIN, y - 12, RIGHT - MARGIN, 20, TINT);
    doc.text(sv ? "Beskrivning" : "Description", MARGIN + 8, y + 1, { size: 8, bold: true, color: MUTED });
    doc.text(sv ? "Antal" : "Qty", columns.quantity, y + 1, { size: 8, bold: true, align: "right", color: MUTED });
    doc.text(sv ? "À-pris" : "Unit price", columns.unit, y + 1, { size: 8, bold: true, align: "right", color: MUTED });
    doc.text(sv ? "Moms" : "VAT", columns.vat, y + 1, { size: 8, bold: true, align: "right", color: MUTED });
    doc.text(sv ? "Belopp" : "Amount", columns.amount, y + 1, { size: 8, bold: true, align: "right", color: MUTED });
    y += 24;
  };
  tableHeader();

  for (const item of input.items) {
    const descriptionLines = wrapText(item.description, 218, 9.5);
    const rowHeight = Math.max(1, descriptionLines.length) * 12.5 + 7;
    if (y + rowHeight > BOTTOM) {
      doc.addPage();
      y = MARGIN + 10;
      tableHeader();
    }
    const net = itemNet(item);
    const unitNet = item.quantity > 0 ? round2(net / item.quantity) : net;
    descriptionLines.forEach((line, index) => doc.text(line, MARGIN + 8, y + index * 12.5, { size: 9.5 }));
    doc.text(formatQuantity(item.quantity, input.locale), columns.quantity, y, { size: 9.5, align: "right" });
    doc.text(money(unitNet), columns.unit, y, { size: 9.5, align: "right" });
    doc.text(formatPercent(itemRate(item), input.locale), columns.vat, y, { size: 9.5, align: "right" });
    doc.text(money(net), columns.amount, y, { size: 9.5, align: "right" });
    y += rowHeight;
  }

  // Totals, with VAT shown per rate.
  const vatByRate = new Map<number, number>();
  for (const item of input.items) {
    if (item.vatAmount <= 0) continue;
    const rate = itemRate(item);
    vatByRate.set(rate, round2((vatByRate.get(rate) ?? 0) + item.vatAmount));
  }
  const totals: { label: string; value: string; bold?: boolean }[] = [
    { label: sv ? "Summa exkl. moms" : "Total excl. VAT", value: money(input.subtotalAmount) }
  ];
  if (vatByRate.size === 0) {
    totals.push({ label: sv ? "Moms" : "VAT", value: money(input.vatAmount) });
  } else {
    for (const [rate, amount] of [...vatByRate.entries()].sort((a, b) => b[0] - a[0])) {
      totals.push({ label: `${sv ? "Moms" : "VAT"} ${formatPercent(rate, input.locale)}`, value: money(amount) });
    }
  }
  totals.push({
    label:
      input.grossLabel ??
      (input.kind === "invoice" ? (sv ? "Summa att betala" : "Total to pay") : sv ? "Summa inkl. moms" : "Total incl. VAT"),
    value: money(input.grossAmount),
    bold: true
  });
  totals.push(...input.extraTotals);

  ensureSpace(totals.length * 16 + 16);
  y += 6;
  for (const row of totals) {
    doc.text(row.label, 350, y, { size: row.bold ? 10.5 : 9.5, bold: row.bold, color: row.bold ? INK : MUTED });
    doc.text(row.value, columns.amount, y, { size: row.bold ? 10.5 : 9.5, bold: row.bold, align: "right" });
    y += row.bold ? 18 : 15;
  }
  y += 10;

  if (input.infoLines && input.infoLines.length > 0) {
    for (const paragraph of input.infoLines) {
      for (const line of wrapText(paragraph, RIGHT - MARGIN, 9)) {
        ensureSpace(13);
        doc.text(line, MARGIN, y, { size: 9 });
        y += 12;
      }
      y += 4;
    }
    y += 8;
  }

  if (input.notes?.trim()) {
    const noteLines = wrapText(input.notes.trim(), RIGHT - MARGIN, 9.5);
    ensureSpace(Math.min(noteLines.length, 4) * 12.5 + 10);
    for (const line of noteLines) {
      ensureSpace(13);
      doc.text(line, MARGIN, y, { size: 9.5 });
      y += 12.5;
    }
    y += 12;
  }

  // How to pay.
  if (input.payment) {
    const payment = input.payment;
    const freeLines = payment.freeText.flatMap((value) => wrapText(value, RIGHT - MARGIN - 32, 9));
    const rightRows = payment.lines.length;
    const boxHeight = 44 + Math.max(58, rightRows * 16 + 6) + (freeLines.length > 0 ? freeLines.length * 12 + 8 : 0);
    ensureSpace(boxHeight + 8);
    doc.rect(MARGIN, y, RIGHT - MARGIN, boxHeight, TINT);
    const top = y;
    doc.text(payment.title, MARGIN + 16, top + 24, { size: 12, bold: true, color: PRIMARY });

    doc.text(payment.amountLabel, MARGIN + 16, top + 48, { size: 8, bold: true, color: MUTED });
    doc.text(payment.amount, MARGIN + 16, top + 68, { size: 16, bold: true });
    doc.text(`${payment.dueLabel} ${payment.due}`, MARGIN + 16, top + 86, { size: 9.5 });

    let rowY = top + 48;
    for (const row of payment.lines) {
      doc.text(row.label, 300, rowY, { size: 9, color: MUTED });
      doc.text(row.value, RIGHT - 16, rowY, { size: 10.5, bold: true, align: "right" });
      rowY += 16;
    }

    let freeY = top + 44 + Math.max(58, rightRows * 16 + 6) + 4;
    for (const line of freeLines) {
      doc.text(line, MARGIN + 16, freeY, { size: 9 });
      freeY += 12;
    }
    y += boxHeight + 16;
  }

  for (const paragraph of input.closing) {
    for (const line of wrapText(paragraph, RIGHT - MARGIN, 8.5)) {
      ensureSpace(12);
      doc.text(line, MARGIN, y, { size: 8.5, color: MUTED });
      y += 11.5;
    }
    y += 3;
  }

  // Footer on the last page: the details every Swedish invoice must carry.
  const footerLines = wrapText(input.footer.filter(Boolean).join("  |  "), RIGHT - MARGIN, 8);
  let footerY = PAGE_HEIGHT - 28 - footerLines.length * 10.5;
  if (y > footerY - 6) {
    doc.addPage();
    footerY = PAGE_HEIGHT - 28 - footerLines.length * 10.5;
  }
  for (const line of footerLines) {
    doc.text(line, MARGIN, footerY, { size: 8, color: MUTED });
    footerY += 10.5;
  }

  return doc.build();
};

const footerFor = (
  sender: PdfParty,
  locale: PdfLocale,
  extra: { vatNumber?: string | null; fSkattRegistered?: boolean }
) => {
  const sv = locale === "sv";
  return [
    sender.name?.trim() ?? "",
    sender.address?.trim() ?? "",
    sender.registration?.trim() ? `${sv ? "Org.nr" : "Reg. no."} ${sender.registration.trim()}` : "",
    extra.vatNumber?.trim() ? `${sv ? "Momsreg.nr" : "VAT no."} ${extra.vatNumber.trim()}` : "",
    extra.fSkattRegistered ? (sv ? "Godkänd för F-skatt" : "Approved for F-tax (F-skatt)") : "",
    sender.email?.trim() ?? "",
    sender.phone?.trim() ?? "",
    sender.website?.trim() ?? ""
  ].filter(Boolean);
};

export const buildInvoicePdf = (invoice: InvoicePdfInput): Buffer => {
  const locale = invoice.locale ?? "en";
  const sv = locale === "sv";
  const money = moneyFormatter(invoice.currency, locale);
  const paid = invoice.paidAmount ?? 0;
  const credited = invoice.creditedAmount ?? 0;
  const rotRut = invoice.rotRut;
  // Skatteverket's part: the preliminary reduction, or what it actually paid once that is known.
  const skatteverketPart = rotRut ? Math.min(rotRut.deduction, rotRut.approvedAmount ?? rotRut.deduction) : 0;
  const remaining = Math.max(0, round2(invoice.grossAmount - skatteverketPart - paid - credited));

  const meta = [
    { label: sv ? "Fakturanummer" : "Invoice number", value: invoice.invoiceNumber },
    { label: sv ? "Fakturadatum" : "Invoice date", value: formatDate(invoice.issueDate) },
    { label: sv ? "Förfallodatum" : "Due date", value: formatDate(invoice.dueDate ?? null) }
  ];
  if (invoice.ocrReference?.trim()) meta.push({ label: sv ? "OCR-nummer" : "OCR reference", value: invoice.ocrReference.trim() });
  if (invoice.projectName?.trim()) meta.push({ label: sv ? "Projekt" : "Project", value: invoice.projectName.trim().slice(0, 34) });

  const extraTotals: DocumentInput["extraTotals"] = [];
  const infoLines: string[] = [];
  if (rotRut) {
    const word = rotRut.type === "ROT" ? "rot" : "rut";
    const percent = formatPercent(rotRut.rate, locale);
    const notApproved = round2(rotRut.deduction - skatteverketPart);
    extraTotals.push(
      { label: sv ? "Varav arbete inkl. moms" : "Of which labour incl. VAT", value: money(rotRut.labourAmount) },
      {
        // Kept short: the label shares the line with the amount.
        label: sv ? `Preliminärt ${word}avdrag ${percent}` : `Preliminary ${rotRut.type} ${percent}`,
        value: money(-rotRut.deduction)
      }
    );
    if (notApproved > 0) {
      extraTotals.push({
        label: sv ? "Ej godkänt av Skatteverket" : "Not paid by Skatteverket",
        value: money(notApproved)
      });
    }
    extraTotals.push({
      label: sv ? "Att betala" : "To pay",
      value: money(round2(invoice.grossAmount - skatteverketPart)),
      bold: true
    });

    const works = rotRut.works
      .map((work) => `${work.label}, ${formatQuantity(work.hours, locale)} ${sv ? "timmar" : "hours"}`)
      .join("; ");
    const buyer = invoice.customer.name?.trim() || "-";
    infoLines.push(
      sv
        ? `${rotRut.type === "ROT" ? "Rotavdrag" : "Rutavdrag"} för ${buyer}, personnummer ${rotRut.personnummer}.${rotRut.property ? ` Bostad: ${rotRut.property}.` : ""}${works ? ` Utfört arbete: ${works}.` : ""}`
        : `${rotRut.type} tax reduction for ${buyer}, personnummer ${rotRut.personnummer}.${rotRut.property ? ` Home: ${rotRut.property}.` : ""}${works ? ` Work done: ${works}.` : ""}`,
      sv
        ? `Arbetskostnad ${money(rotRut.labourAmount)}, material ${money(rotRut.materialAmount)}, övriga kostnader ${money(rotRut.otherAmount)} (allt inkl. moms). Skattereduktionen beräknas bara på arbetskostnaden.`
        : `Labour ${money(rotRut.labourAmount)}, material ${money(rotRut.materialAmount)}, other costs ${money(rotRut.otherAmount)} (all incl. VAT). The tax reduction is calculated on the labour cost only.`,
      notApproved > 0
        ? sv
          ? `Skatteverket har betalat ut ${money(skatteverketPart)} av de ${money(rotRut.deduction)} vi begärde för din räkning. Mellanskillnaden, ${money(notApproved)}, ska därför betalas av dig.`
          : `Skatteverket has paid ${money(skatteverketPart)} of the ${money(rotRut.deduction)} we requested on your behalf. The difference, ${money(notApproved)}, is therefore yours to pay.`
        : sv
          ? `Du betalar ${money(round2(invoice.grossAmount - rotRut.deduction))}. Resten, ${money(rotRut.deduction)}, begär vi från Skatteverket som preliminär skattereduktion för din räkning. Betalningen ska göras elektroniskt, inte kontant. Om Skatteverket inte betalar ut hela beloppet, till exempel för att du redan har använt ditt utrymme för året, är du betalningsskyldig för mellanskillnaden.`
          : `You pay ${money(round2(invoice.grossAmount - rotRut.deduction))}. The rest, ${money(rotRut.deduction)}, we request from Skatteverket as a preliminary tax reduction on your behalf. The payment must be made electronically, not in cash. If Skatteverket does not pay the whole amount, for example because you have already used your allowance for the year, you are liable for the difference.`
    );
  }
  if (paid > 0) extraTotals.push({ label: sv ? "Betalt" : "Paid", value: money(-paid) });
  if (credited > 0) extraTotals.push({ label: sv ? "Krediterat" : "Credited", value: money(-credited) });
  if (paid > 0 || credited > 0) {
    extraTotals.push({ label: sv ? "Kvar att betala" : "Left to pay", value: money(remaining), bold: true });
  }

  const accountLines = paymentAccountLines(invoice.paymentAccounts ?? {});
  const referenceLine = invoice.ocrReference?.trim()
    ? { label: sv ? "OCR-nummer" : "OCR reference", value: invoice.ocrReference.trim() }
    : { label: sv ? "Ange vid betalning" : "Quote when paying", value: invoice.invoiceNumber };
  const freeText = [
    accountLines.length === 0 && invoice.paymentMethod?.trim() ? invoice.paymentMethod.trim() : "",
    invoice.paymentDetails?.trim() ?? ""
  ].filter(Boolean);

  return renderDocument({
    kind: "invoice",
    locale,
    title: sv ? "FAKTURA" : "INVOICE",
    number: invoice.invoiceNumber,
    sender: invoice.sender,
    customer: invoice.customer,
    meta,
    items: invoice.items,
    currency: invoice.currency,
    subtotalAmount: invoice.subtotalAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
    extraTotals,
    grossLabel: rotRut ? (sv ? "Summa inkl. moms" : "Total incl. VAT") : undefined,
    infoLines,
    notes: invoice.notes,
    payment:
      remaining > 0
        ? {
            title: sv ? "Så här betalar du" : "How to pay",
            amountLabel: sv ? "ATT BETALA" : "AMOUNT TO PAY",
            amount: money(remaining),
            dueLabel: sv ? "Betala senast" : "Pay by",
            due: formatDate(invoice.dueDate ?? null),
            lines: [...accountLines, referenceLine],
            freeText
          }
        : undefined,
    closing: [
      sv
        ? "Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen."
        : "Late interest under the Swedish Interest Act (räntelagen) is charged on payment after the due date."
    ],
    footer: footerFor(invoice.sender, locale, invoice)
  });
};

export const buildQuotePdf = (quote: QuotePdfInput): Buffer => {
  const locale = quote.locale ?? "en";
  const sv = locale === "sv";

  const meta = [
    { label: sv ? "Offertnummer" : "Quote number", value: quote.quoteNumber },
    { label: sv ? "Datum" : "Date", value: formatDate(quote.issueDate) }
  ];
  if (quote.validUntil) meta.push({ label: sv ? "Giltig till och med" : "Valid until", value: formatDate(quote.validUntil) });
  if (quote.projectName?.trim()) meta.push({ label: sv ? "Projekt" : "Project", value: quote.projectName.trim().slice(0, 34) });

  return renderDocument({
    kind: "quote",
    locale,
    title: sv ? "OFFERT" : "QUOTE",
    number: quote.quoteNumber,
    sender: quote.sender,
    customer: quote.customer,
    meta,
    intro: quote.description,
    items: quote.items,
    currency: quote.currency,
    subtotalAmount: quote.subtotalAmount,
    vatAmount: quote.vatAmount,
    grossAmount: quote.grossAmount,
    extraTotals: [],
    notes: quote.notes,
    closing: [
      quote.validUntil
        ? sv
          ? `Offerten gäller till och med ${formatDate(quote.validUntil)}. Hör av dig för att tacka ja.`
          : `This quote is valid until ${formatDate(quote.validUntil)}. Get in touch to accept it.`
        : sv
          ? "Hör av dig för att tacka ja till offerten."
          : "Get in touch to accept the quote."
    ],
    footer: footerFor(quote.sender, locale, quote)
  });
};
