/**
 * What the invoice and quote forms hold while the user is typing: customer
 * details and line items as text, and how they turn into a request body.
 * Plain functions with no React, so pages on the server can use them too.
 */

import { computeInvoiceItem, computeInvoiceTotals, normalizeVatRate } from "@/lib/invoices/calculations";
import { isRotRutWorkType, type RotRutLine, type RotRutType, rotRutWorkTypes } from "@/lib/invoices/rotrut";
import { InvoiceVatModes, type InvoiceItemInput, type InvoiceVatMode } from "@/lib/invoices/types";

/** One line as the user is typing it. Shared by the invoice and quote forms. */
export type LineItemDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatMode: InvoiceVatMode;
  vatRate: string;
  /**
   * ROT/RUT (invoice form only; a quote never sets these). Left unset a line
   * counts as labour, with the invoice's main type of work and the quantity
   * as hours, so turning ROT/RUT on needs no extra clicks for a labour-only
   * invoice.
   */
  rotRutLabour?: boolean;
  /** Labour: the type of work. Other lines: the type of work the material belongs to, or ROT_RUT_OTHER_COST. */
  rotRutWorkType?: string;
  rotRutHours?: string;
};

/** A line that is neither labour nor material: travel, equipment, administration. */
export const ROT_RUT_OTHER_COST = "OTHER";

const toNumber = (value: string) => {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

let keyCounter = 0;
const nextKey = () => {
  keyCounter += 1;
  return `line-${keyCounter}-${Math.random().toString(16).slice(2, 8)}`;
};

/** A new empty line. A VAT registered business starts at 25 % with prices excluding VAT. */
export const makeLineItem = (vatRegistered: boolean, overrides: Partial<LineItemDraft> = {}): LineItemDraft => ({
  key: nextKey(),
  description: "",
  quantity: "1",
  unitPrice: "",
  vatMode: vatRegistered ? InvoiceVatModes.EXCLUSIVE : InvoiceVatModes.NO_VAT,
  vatRate: vatRegistered ? "0.25" : "0",
  ...overrides
});

export const draftsToItems = (drafts: LineItemDraft[]): InvoiceItemInput[] =>
  drafts.map((item) => ({
    description: item.description,
    quantity: toNumber(item.quantity || "0"),
    unitPrice: toNumber(item.unitPrice || "0"),
    vatMode: item.vatMode,
    vatRate: item.vatMode === InvoiceVatModes.NO_VAT ? 0 : normalizeVatRate(toNumber(item.vatRate || "0"))
  }));

export const itemsToDrafts = (
  items: { description: string; quantity: number; unitPrice: number; vatMode: string; vatRate: number }[]
): LineItemDraft[] =>
  items.map((item) => ({
    key: nextKey(),
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    vatMode:
      item.vatMode === InvoiceVatModes.INCLUSIVE || item.vatMode === InvoiceVatModes.EXCLUSIVE
        ? item.vatMode
        : InvoiceVatModes.NO_VAT,
    vatRate: String(item.vatRate)
  }));

/**
 * What each line counts as on a ROT/RUT invoice, with the defaults filled in:
 * every line is labour until unticked, labour without a chosen type of work
 * follows the first line that has one, and hours start as the quantity.
 */
export const rotRutDraftLines = (drafts: LineItemDraft[], type: RotRutType): RotRutLine[] => {
  const firstChosen = drafts.find((item) => (item.rotRutLabour ?? true) && isRotRutWorkType(type, item.rotRutWorkType));
  const fallback = firstChosen?.rotRutWorkType ?? rotRutWorkTypes(type)[0].code;
  const labourType = (item: LineItemDraft) =>
    isRotRutWorkType(type, item.rotRutWorkType) ? (item.rotRutWorkType as string) : fallback;
  const labourTypes = drafts.filter((item) => item.rotRutLabour ?? true).map(labourType);
  return drafts.map((item) => {
    const totalAmount = computeInvoiceItem(draftsToItems([item])[0]).totalAmount;
    if (item.rotRutLabour ?? true) {
      return { totalAmount, labour: true, workType: labourType(item), hours: toNumber(item.rotRutHours ?? item.quantity ?? "0") };
    }
    if (item.rotRutWorkType === ROT_RUT_OTHER_COST) return { totalAmount, labour: false, workType: null, hours: null };
    // Material belongs to a type of work that is on the invoice.
    const own = item.rotRutWorkType && labourTypes.includes(item.rotRutWorkType) ? item.rotRutWorkType : null;
    return { totalAmount, labour: false, workType: own ?? labourTypes[0] ?? fallback, hours: null };
  });
};

/** The lines of a ROT/RUT invoice as the request body wants them. */
export const draftsToRotRutItems = (drafts: LineItemDraft[], type: RotRutType): InvoiceItemInput[] => {
  const lines = rotRutDraftLines(drafts, type);
  return draftsToItems(drafts).map((item, index) => ({
    ...item,
    rotRutLabour: lines[index].labour,
    rotRutWorkType: lines[index].workType ?? null,
    rotRutHours: lines[index].labour ? (lines[index].hours ?? 0) : null
  }));
};

export const totalsOfDrafts = (drafts: LineItemDraft[]) => computeInvoiceTotals(draftsToItems(drafts));

/** Customer details on a document being written. Shared by the invoice and quote forms. */
export type CustomerDraft = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
};

export type CustomerOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
};

export const emptyCustomer = (): CustomerDraft => ({
  name: "",
  email: "",
  phone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  postalCode: "",
  country: ""
});

export const customerFromOption = (option: CustomerOption): CustomerDraft => ({
  id: option.id,
  name: option.name,
  email: option.email ?? "",
  phone: option.phone ?? "",
  website: option.website ?? "",
  addressLine1: option.addressLine1 ?? "",
  addressLine2: option.addressLine2 ?? "",
  city: option.city ?? "",
  postalCode: option.postalCode ?? "",
  country: option.country ?? ""
});

/** The customer part of an invoice or quote request body. */
export const customerPayload = (customer: CustomerDraft) => ({
  id: customer.id || undefined,
  name: customer.name.trim(),
  email: customer.email.trim() || undefined,
  phone: customer.phone.trim() || undefined,
  website: customer.website.trim() || undefined,
  addressLine1: customer.addressLine1.trim() || undefined,
  addressLine2: customer.addressLine2.trim() || undefined,
  city: customer.city.trim() || undefined,
  postalCode: customer.postalCode.trim() || undefined,
  country: customer.country.trim() || undefined
});

export const customerAddressLine = (customer: CustomerDraft) =>
  [customer.addressLine1, customer.addressLine2, customer.postalCode, customer.city, customer.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
