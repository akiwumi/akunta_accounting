import { round2 } from "@/lib/accounting/math";
import { InvoiceVatModes, type InvoiceItemComputed, type InvoiceItemInput, type InvoiceVatMode } from "@/lib/invoices/types";

const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export const normalizeVatRate = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return round4(Math.min(1, Math.max(0, value)));
};

const normalizeVatMode = (value: string): InvoiceVatMode => {
  if (value === InvoiceVatModes.INCLUSIVE) return InvoiceVatModes.INCLUSIVE;
  if (value === InvoiceVatModes.EXCLUSIVE) return InvoiceVatModes.EXCLUSIVE;
  return InvoiceVatModes.NO_VAT;
};

export const computeInvoiceItem = (input: InvoiceItemInput): InvoiceItemComputed => {
  const quantity = round4(Math.max(0, input.quantity));
  const unitPrice = round2(Math.max(0, input.unitPrice));
  const vatMode = normalizeVatMode(input.vatMode);
  const vatRate = vatMode === InvoiceVatModes.NO_VAT ? 0 : normalizeVatRate(input.vatRate);

  const amount = round2(quantity * unitPrice);

  if (vatMode === InvoiceVatModes.NO_VAT || vatRate <= 0) {
    return {
      description: input.description.trim(),
      quantity,
      unitPrice,
      vatMode,
      vatRate: 0,
      netAmount: amount,
      vatAmount: 0,
      totalAmount: amount
    };
  }

  if (vatMode === InvoiceVatModes.INCLUSIVE) {
    const netAmount = round2(amount / (1 + vatRate));
    const vatAmount = round2(amount - netAmount);
    return {
      description: input.description.trim(),
      quantity,
      unitPrice,
      vatMode,
      vatRate,
      netAmount,
      vatAmount,
      totalAmount: amount
    };
  }

  const netAmount = amount;
  const vatAmount = round2(netAmount * vatRate);
  const totalAmount = round2(netAmount + vatAmount);
  return {
    description: input.description.trim(),
    quantity,
    unitPrice,
    vatMode,
    vatRate,
    netAmount,
    vatAmount,
    totalAmount
  };
};

export const computeInvoiceTotals = (items: InvoiceItemInput[]) => {
  const computedItems = items
    .map((item) => computeInvoiceItem(item))
    .filter((item) => item.description.length > 0 && item.quantity > 0);

  const subtotal = round2(computedItems.reduce((sum, item) => sum + item.netAmount, 0));
  const vatAmount = round2(computedItems.reduce((sum, item) => sum + item.vatAmount, 0));
  const grossAmount = round2(computedItems.reduce((sum, item) => sum + item.totalAmount, 0));
  const vatRate = subtotal > 0 ? round4(vatAmount / subtotal) : 0;

  return {
    items: computedItems,
    subtotal,
    vatAmount,
    grossAmount,
    vatRate
  };
};
