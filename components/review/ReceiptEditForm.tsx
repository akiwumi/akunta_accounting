"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type ReceiptEditFormProps = {
  receiptId: string;
  locale: Locale;
  initial: {
    receiptNumber: string;
    vendor: string;
    receiptDate: string;
    category: string;
    vatRate: string;
    vatAmount: string;
    grossAmount: string;
    currency: string;
  };
};

export const ReceiptEditForm = ({ receiptId, locale, initial }: ReceiptEditFormProps) => {
  const router = useRouter();
  const copy =
    locale === "sv"
      ? {
          title: "Redigera underlag",
          receiptNumber: "Kvittonummer",
          vendor: "Leverantör",
          receiptDate: "Utfärdandedatum",
          category: "Kategori",
          grossAmount: "Bruttobelopp",
          vatAmount: "Momsbelopp",
          currency: "Valuta",
          vatRate: "Momssats (decimal)",
          save: "Spara ändringar",
          saving: "Sparar...",
          saved: "Ändringar sparade.",
          invalidCurrency: "Ange en valutakod med tre bokstäver, till exempel SEK eller USD.",
          failed: "Kunde inte spara ändringar.",
          unknown: "Okänt fel"
        }
      : {
          title: "Edit Input",
          receiptNumber: "Receipt Number",
          vendor: "Vendor",
          receiptDate: "Issue date",
          category: "Category",
          grossAmount: "Gross amount",
          vatAmount: "VAT amount",
          currency: "Currency",
          vatRate: "VAT rate (decimal)",
          save: "Save changes",
          saving: "Saving...",
          saved: "Changes saved.",
          invalidCurrency: "Use a 3-letter currency code such as SEK or USD.",
          failed: "Failed to save changes.",
          unknown: "Unknown error"
        };

  const [receiptNumber, setReceiptNumber] = useState(initial.receiptNumber);
  const [vendor, setVendor] = useState(initial.vendor);
  const [receiptDate, setReceiptDate] = useState(initial.receiptDate);
  const [category, setCategory] = useState(initial.category);
  const [grossAmount, setGrossAmount] = useState(initial.grossAmount);
  const [vatAmount, setVatAmount] = useState(initial.vatAmount);
  const [currency, setCurrency] = useState(initial.currency || "SEK");
  const [vatRate, setVatRate] = useState(initial.vatRate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const vatValue = Number(vatRate.replace(",", "."));
      const grossValue = Number(grossAmount.replace(",", "."));
      const vatAmountValue = Number(vatAmount.replace(",", "."));
      const normalizedCurrency = currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
        throw new Error(copy.invalidCurrency);
      }
      const response = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptNumber: receiptNumber.trim() || null,
          vendor: vendor.trim() || null,
          receiptDate: receiptDate || null,
          category: category.trim() || null,
          vatRate: Number.isFinite(vatValue) ? vatValue : null,
          vatAmount: Number.isFinite(vatAmountValue) && vatAmountValue >= 0 ? vatAmountValue : null,
          grossAmount: Number.isFinite(grossValue) && grossValue > 0 ? grossValue : null,
          currency: normalizedCurrency
        })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? copy.failed);
      }
      setSuccess(copy.saved);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : copy.unknown);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3>{copy.title}</h3>
      <div className="row">
        <label className="stack">
          {copy.receiptNumber}
          <input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} />
        </label>
        <label className="stack">
          {copy.vendor}
          <input value={vendor} onChange={(event) => setVendor(event.target.value)} />
        </label>
        <label className="stack">
          {copy.receiptDate}
          <input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          {copy.category}
          <input value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label className="stack">
          {copy.grossAmount}
          <input
            type="number"
            min="0"
            step="0.01"
            value={grossAmount}
            onChange={(event) => setGrossAmount(event.target.value)}
          />
        </label>
        <label className="stack">
          {copy.vatAmount}
          <input
            type="number"
            min="0"
            step="0.01"
            value={vatAmount}
            onChange={(event) => setVatAmount(event.target.value)}
          />
        </label>
        <label className="stack">
          {copy.currency}
          <input
            value={currency}
            maxLength={3}
            placeholder="SEK / EUR / USD"
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <label className="stack">
          {copy.vatRate}
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={vatRate}
            onChange={(event) => setVatRate(event.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? copy.saving : copy.save}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </form>
  );
};
