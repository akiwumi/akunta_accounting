import Papa from "papaparse";

import { round2 } from "@/lib/accounting/math";

export type ParsedBankRow = {
  rowNumber: number;
  txnDate: Date;
  description: string;
  amount: number;
  vatRate: number;
  category: string;
  currency: string;
};

const parseDate = (raw: string): Date => {
  const value = raw.trim();
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`);

  const euMatch = value.match(/^(\d{2})[/. -](\d{2})[/. -](\d{4})$/);
  if (euMatch) return new Date(`${euMatch[3]}-${euMatch[2]}-${euMatch[1]}T00:00:00.000Z`);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid date: ${raw}`);
  return parsed;
};

export const parseBankCsv = (csvText: string): ParsedBankRow[] => {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parsing failed: ${result.errors[0].message}`);
  }

  return result.data.map((row, index) => {
    const dateRaw = row.date ?? row.Date ?? row.booking_date ?? row.BookingDate;
    const descriptionRaw = row.description ?? row.Description ?? row.text ?? row.Text;
    const amountRaw = row.amount ?? row.Amount ?? row.transaction_amount ?? row.TransactionAmount;
    const vatRateRaw = row.vat_rate ?? row.VATRate ?? row.vatRate ?? "0.25";
    const categoryRaw = row.category ?? row.Category ?? "other";
    const currencyRaw = row.currency ?? row.Currency ?? "SEK";

    if (!dateRaw || !descriptionRaw || !amountRaw) {
      throw new Error(`Row ${index + 2} is missing required fields (date, description, amount).`);
    }

    const amount = Number(amountRaw.replace(",", "."));
    if (Number.isNaN(amount)) {
      throw new Error(`Row ${index + 2} has invalid amount: ${amountRaw}`);
    }

    const vatRate = Number(String(vatRateRaw).replace(",", "."));
    if (Number.isNaN(vatRate)) {
      throw new Error(`Row ${index + 2} has invalid VAT rate: ${vatRateRaw}`);
    }

    return {
      rowNumber: index + 2,
      txnDate: parseDate(dateRaw),
      description: descriptionRaw.trim(),
      amount: round2(amount),
      vatRate: Math.max(0, vatRate),
      category: categoryRaw.trim(),
      currency: currencyRaw.trim().toUpperCase()
    };
  });
};
