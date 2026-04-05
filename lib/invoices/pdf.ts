import { buildSimplePdf } from "@/lib/accounting/pdf";

type InvoicePdfParty = {
  name?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  registration?: string | null;
};

type InvoicePdfItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatAmount: number;
  totalAmount: number;
};

export type InvoicePdfInput = {
  invoiceNumber: string;
  projectName?: string | null;
  issueDate: Date;
  dueDate?: Date | null;
  currency: string;
  sender: InvoicePdfParty;
  customer: InvoicePdfParty;
  items: InvoicePdfItem[];
  subtotalAmount: number;
  vatAmount: number;
  grossAmount: number;
  notes?: string | null;
  paymentMethod?: string | null;
  paymentDetails?: string | null;
};

const numberLocale = "en-GB";

const formatMoney = (value: number, currency: string) => {
  const normalized = currency.trim().toUpperCase();
  const safeCurrency = /^[A-Z]{3}$/.test(normalized) ? normalized : "SEK";

  try {
    return new Intl.NumberFormat(numberLocale, {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${safeCurrency}`;
  }
};

const formatDate = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "-");

const appendPartyLines = (label: string, party: InvoicePdfParty, lines: string[]) => {
  lines.push(label);
  lines.push(`  Name: ${party.name?.trim() || "-"}`);
  if (party.registration?.trim()) lines.push(`  Org/Reg: ${party.registration.trim()}`);
  if (party.address?.trim()) lines.push(`  Address: ${party.address.trim()}`);
  if (party.email?.trim()) lines.push(`  Email: ${party.email.trim()}`);
  if (party.phone?.trim()) lines.push(`  Phone: ${party.phone.trim()}`);
  if (party.website?.trim()) lines.push(`  Website: ${party.website.trim()}`);
};

export const buildInvoicePdf = (invoice: InvoicePdfInput) => {
  const lines: string[] = [];
  lines.push(`Invoice Number: ${invoice.invoiceNumber}`);
  lines.push(`Issue Date: ${formatDate(invoice.issueDate)}`);
  lines.push(`Due Date: ${formatDate(invoice.dueDate ?? null)}`);
  if (invoice.projectName?.trim()) lines.push(`Project: ${invoice.projectName.trim()}`);
  lines.push("");

  appendPartyLines("From:", invoice.sender, lines);
  lines.push("");
  appendPartyLines("To:", invoice.customer, lines);
  lines.push("");

  lines.push("Items:");
  lines.push("  Description | Qty | Unit Price | VAT | Amount");
  invoice.items.forEach((item) => {
    lines.push(
      `  ${item.description} | ${item.quantity} | ${formatMoney(item.unitPrice, invoice.currency)} | ${formatMoney(item.vatAmount, invoice.currency)} | ${formatMoney(item.totalAmount, invoice.currency)}`
    );
  });
  lines.push("");
  lines.push(`Subtotal: ${formatMoney(invoice.subtotalAmount, invoice.currency)}`);
  lines.push(`VAT: ${formatMoney(invoice.vatAmount, invoice.currency)}`);
  lines.push(`Total: ${formatMoney(invoice.grossAmount, invoice.currency)}`);

  if (invoice.notes?.trim()) {
    lines.push("");
    lines.push(`Notes: ${invoice.notes.trim()}`);
  }

  if (invoice.paymentMethod?.trim() || invoice.paymentDetails?.trim()) {
    lines.push("");
    lines.push(`Payment Method: ${invoice.paymentMethod?.trim() || "-"}`);
    if (invoice.paymentDetails?.trim()) {
      lines.push(`Payment Details: ${invoice.paymentDetails.trim()}`);
    }
  }

  return buildSimplePdf({
    title: "Invoice",
    subtitle: `#${invoice.invoiceNumber}`,
    lines
  });
};
