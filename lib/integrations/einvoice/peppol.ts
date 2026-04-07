/**
 * PEPPOL BIS Billing 3.0 — UBL 2.1 XML generator for Swedish invoices.
 *
 * Produces a valid EN 16931 compliant invoice document that can be delivered
 * via a PEPPOL Access Point. The output targets the Swedish Svefaktura profile
 * used for B2G and B2B e-invoicing.
 *
 * References:
 *   - PEPPOL BIS Billing 3.0: https://docs.peppol.eu/poacc/billing/3.0/
 *   - EN 16931 (CEN TS 16931-1): European e-invoicing standard
 *   - Svefaktura 2.0 extension: https://www.sfti.se/standarder/svefaktura.html
 *
 * No external XML libraries — generates the document as a template string.
 * All values are XML-escaped to prevent injection.
 */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface PeppolParty {
  name: string;
  orgNumber?: string;       // Swedish org number or personal number
  vatNumber?: string;       // SE + number + 01
  peppolId?: string;        // 0007:<org-number> for Swedish parties
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;     // ISO 3166-1 alpha-2, default "SE"
  email?: string;
}

export interface PeppolLineItem {
  id: string | number;
  description: string;
  quantity: number;
  unitCode?: string;         // UN/ECE, default "C62" (piece)
  unitPrice: number;         // net unit price in SEK
  vatRate: number;           // 0–1, e.g. 0.25
  netAmount: number;         // quantity × unitPrice
  vatAmount: number;
}

export interface PeppolInvoiceInput {
  invoiceNumber: string;
  invoiceTypeCode?: "380" | "381";  // 380 = invoice, 381 = credit note
  issueDate: string;                // YYYY-MM-DD
  dueDate?: string;                 // YYYY-MM-DD
  currencyCode?: string;            // default "SEK"
  buyerReference?: string;          // order reference / PO number
  supplier: PeppolParty;
  customer: PeppolParty;
  lines: PeppolLineItem[];
  notes?: string;
  /** Whether supplier is F-skatt approved — shown as a note per Swedish practice. */
  fSkattApproved?: boolean;
}

export interface PeppolInvoiceOutput {
  xml: string;
  filename: string;
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmt2(n: number): string {
  return n.toFixed(2);
}

// ─── Party block ─────────────────────────────────────────────────────────────

function partyBlock(party: PeppolParty, role: "AccountingSupplierParty" | "AccountingCustomerParty"): string {
  const country = party.countryCode ?? "SE";
  const peppolEndpoint = party.peppolId
    ? `<cbc:EndpointID schemeID="0007">${esc(party.peppolId.replace(/^0007:/, ""))}</cbc:EndpointID>`
    : "";
  const partyIdentification = party.orgNumber
    ? `<cac:PartyIdentification><cbc:ID schemeID="0007">${esc(party.orgNumber)}</cbc:ID></cac:PartyIdentification>`
    : "";
  const vatTaxScheme = party.vatNumber
    ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(party.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`
    : "";
  const legalEntity = party.orgNumber
    ? `<cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(party.name)}</cbc:RegistrationName>
        <cbc:CompanyID>${esc(party.orgNumber)}</cbc:CompanyID>
      </cac:PartyLegalEntity>`
    : `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(party.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`;
  const contact = party.email
    ? `<cac:Contact><cbc:ElectronicMail>${esc(party.email)}</cbc:ElectronicMail></cac:Contact>`
    : "";

  return `<cac:${role}>
    <cac:Party>
      ${peppolEndpoint}
      ${partyIdentification}
      <cac:PostalAddress>
        ${party.addressLine1 ? `<cbc:StreetName>${esc(party.addressLine1)}</cbc:StreetName>` : ""}
        ${party.city ? `<cbc:CityName>${esc(party.city)}</cbc:CityName>` : ""}
        ${party.postalCode ? `<cbc:PostalZone>${esc(party.postalCode)}</cbc:PostalZone>` : ""}
        <cac:Country><cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${vatTaxScheme}
      ${legalEntity}
      ${contact}
    </cac:Party>
  </cac:${role}>`;
}

// ─── VAT totals ───────────────────────────────────────────────────────────────

function taxTotalBlock(lines: PeppolLineItem[], currencyCode: string): string {
  const byRate = new Map<number, { taxableAmount: number; taxAmount: number }>();
  for (const line of lines) {
    const existing = byRate.get(line.vatRate);
    if (existing) {
      existing.taxableAmount += line.netAmount;
      existing.taxAmount += line.vatAmount;
    } else {
      byRate.set(line.vatRate, {
        taxableAmount: line.netAmount,
        taxAmount: line.vatAmount,
      });
    }
  }

  const totalTax = lines.reduce((s, l) => s + l.vatAmount, 0);

  const subtotals = [...byRate.entries()]
    .map(
      ([rate, { taxableAmount, taxAmount }]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${esc(currencyCode)}">${fmt2(taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${esc(currencyCode)}">${fmt2(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${rate > 0 ? "S" : "Z"}</cbc:ID>
        <cbc:Percent>${fmt2(rate * 100)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    )
    .join("\n");

  return `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${esc(currencyCode)}">${fmt2(totalTax)}</cbc:TaxAmount>
    ${subtotals}
  </cac:TaxTotal>`;
}

// ─── Invoice lines ────────────────────────────────────────────────────────────

function invoiceLineBlock(line: PeppolLineItem, currencyCode: string): string {
  const unitCode = line.unitCode ?? "C62";
  return `<cac:InvoiceLine>
    <cbc:ID>${esc(line.id)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(unitCode)}">${fmt2(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${esc(currencyCode)}">${fmt2(line.netAmount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${esc(line.description)}</cbc:Description>
      <cbc:Name>${esc(line.description.slice(0, 80))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${line.vatRate > 0 ? "S" : "Z"}</cbc:ID>
        <cbc:Percent>${fmt2(line.vatRate * 100)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${esc(currencyCode)}">${fmt2(line.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a PEPPOL BIS Billing 3.0 UBL 2.1 XML invoice document.
 */
export function generatePeppolInvoice(input: PeppolInvoiceInput): PeppolInvoiceOutput {
  const {
    invoiceNumber,
    invoiceTypeCode = "380",
    issueDate,
    dueDate,
    currencyCode = "SEK",
    buyerReference,
    supplier,
    customer,
    lines,
    notes,
    fSkattApproved,
  } = input;

  const netTotal   = lines.reduce((s, l) => s + l.netAmount, 0);
  const vatTotal   = lines.reduce((s, l) => s + l.vatAmount, 0);
  const grossTotal = netTotal + vatTotal;

  const noteBlocks = [
    notes ? `<cbc:Note>${esc(notes)}</cbc:Note>` : "",
    fSkattApproved ? `<cbc:Note>Godkänd för F-skatt</cbc:Note>` : "",
  ]
    .filter(Boolean)
    .join("\n  ");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${esc(issueDate)}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${esc(dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${esc(invoiceTypeCode)}</cbc:InvoiceTypeCode>
  ${noteBlocks}
  <cbc:DocumentCurrencyCode>${esc(currencyCode)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${esc(currencyCode)}</cbc:TaxCurrencyCode>
  ${buyerReference ? `<cbc:BuyerReference>${esc(buyerReference)}</cbc:BuyerReference>` : ""}

  ${partyBlock(supplier, "AccountingSupplierParty")}
  ${partyBlock(customer, "AccountingCustomerParty")}

  ${taxTotalBlock(lines, currencyCode)}

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${esc(currencyCode)}">${fmt2(netTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${esc(currencyCode)}">${fmt2(netTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${esc(currencyCode)}">${fmt2(grossTotal)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${esc(currencyCode)}">${fmt2(grossTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${lines.map((l) => invoiceLineBlock(l, currencyCode)).join("\n\n  ")}

</ubl:Invoice>`;

  return {
    xml: xml.trim(),
    filename: `invoice-${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "_")}.xml`,
  };
}

/**
 * Build PeppolInvoiceInput from app domain objects.
 * Accepts Prisma Invoice + Business shapes (partial, keys typed loosely).
 */
export function buildPeppolInputFromInvoice(
  invoice: {
    invoiceNumber: string;
    issueDate: Date;
    dueDate?: Date | null;
    customerName: string;
    customerEmail?: string | null;
    customerAddress?: string | null;
    senderName?: string | null;
    senderAddress?: string | null;
    senderOrgNumber?: string | null;
    senderEmail?: string | null;
    notes?: string | null;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      netAmount: number;
      vatAmount: number;
    }>;
  },
  business: {
    vatNumber?: string | null;
    peppolId?: string | null;
    fSkattRegistered?: boolean;
    personnummer?: string | null;
  }
): PeppolInvoiceInput {
  const supplier: PeppolParty = {
    name: invoice.senderName ?? "Supplier",
    orgNumber: invoice.senderOrgNumber ?? business.personnummer ?? undefined,
    vatNumber: business.vatNumber ?? undefined,
    peppolId: business.peppolId ?? undefined,
    addressLine1: invoice.senderAddress ?? undefined,
    email: invoice.senderEmail ?? undefined,
    countryCode: "SE",
  };

  const customer: PeppolParty = {
    name: invoice.customerName,
    email: invoice.customerEmail ?? undefined,
    addressLine1: invoice.customerAddress ?? undefined,
    countryCode: "SE",
  };

  const lines: PeppolLineItem[] = invoice.items.map((item, idx) => ({
    id: idx + 1,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    vatRate: item.vatRate,
    netAmount: item.netAmount,
    vatAmount: item.vatAmount,
  }));

  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate?.toISOString().slice(0, 10),
    currencyCode: "SEK",
    supplier,
    customer,
    lines,
    notes: invoice.notes ?? undefined,
    fSkattApproved: business.fSkattRegistered ?? false,
  };
}
