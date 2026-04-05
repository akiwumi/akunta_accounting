"use client";

import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type PaymentReceivedResponse = {
  transaction?: {
    id: string;
  };
  error?: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export const PaymentReceivedForm = ({ locale }: { locale: Locale }) => {
  const copy =
    locale === "sv"
      ? {
          title: "Registrera betalning in",
          subtitle: "Lägg till en betalning du fått från kund. Om referensen matchar ett fakturanummer markeras fakturan som betald.",
          payer: "Betalare",
          description: "Beskrivning",
          date: "Betalningsdatum",
          amount: "Bruttobelopp",
          vatRate: "Momssats (decimal)",
          currency: "Valuta",
          reference: "Referens (fakturanr.)",
          incomeAccount: "Intäktskonto",
          save: "Spara betalning",
          saving: "Sparar...",
          amountError: "Belopp måste vara större än 0.",
          success: "Betalning sparad.",
          failed: "Kunde inte spara betalning.",
          unknown: "Okänt fel",
          transactionId: "Transaktions-ID"
        }
      : {
          title: "Add Payment Received",
          subtitle: "Log a customer payment received. If reference matches an invoice number, that invoice is marked paid.",
          payer: "Payer",
          description: "Description",
          date: "Payment date",
          amount: "Gross amount",
          vatRate: "VAT rate (decimal)",
          currency: "Currency",
          reference: "Reference (invoice no.)",
          incomeAccount: "Income account",
          save: "Save payment",
          saving: "Saving...",
          amountError: "Amount must be greater than 0.",
          success: "Payment saved.",
          failed: "Failed to save payment.",
          unknown: "Unknown error",
          transactionId: "Transaction ID"
        };

  const [payer, setPayer] = useState("");
  const [description, setDescription] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [grossAmount, setGrossAmount] = useState("");
  const [vatRate, setVatRate] = useState("0.25");
  const [currency, setCurrency] = useState("SEK");
  const [reference, setReference] = useState("");
  const [incomeAccountCode, setIncomeAccountCode] = useState("3001");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentReceivedResponse | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedAmount = Number(grossAmount.replace(",", "."));
    const parsedVatRate = Number(vatRate.replace(",", "."));

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(copy.amountError);
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/payments/received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payer: payer.trim(),
          description: description.trim() || undefined,
          paymentDate,
          grossAmount: parsedAmount,
          vatRate: Number.isFinite(parsedVatRate) ? parsedVatRate : 0.25,
          currency,
          reference: reference.trim() || undefined,
          incomeAccountCode: incomeAccountCode.trim() || "3001"
        })
      });
      const json = (await response.json()) as PaymentReceivedResponse;
      if (!response.ok) {
        throw new Error(json.error ?? copy.failed);
      }

      setResult(json);
      setDescription("");
      setGrossAmount("");
      setReference("");
      setPayer("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : copy.unknown);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3>{copy.title}</h3>
      <p className="note">{copy.subtitle}</p>

      <div className="row">
        <label className="stack">
          {copy.payer}
          <input value={payer} onChange={(event) => setPayer(event.target.value)} required />
        </label>
        <label className="stack">
          {copy.description}
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>

      <div className="row">
        <label className="stack">
          {copy.date}
          <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
        </label>
        <label className="stack">
          {copy.amount}
          <input
            type="number"
            min="0"
            step="0.01"
            value={grossAmount}
            onChange={(event) => setGrossAmount(event.target.value)}
            required
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
        <label className="stack">
          {copy.currency}
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="SEK">SEK</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
        <label className="stack">
          {copy.reference}
          <input value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="stack">
          {copy.incomeAccount}
          <input value={incomeAccountCode} onChange={(event) => setIncomeAccountCode(event.target.value)} />
        </label>
      </div>

      <div className="row">
        <button type="submit" disabled={submitting}>
          {submitting ? copy.saving : copy.save}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {result?.transaction && (
        <div className="card">
          <p className="success">{copy.success}</p>
          <p className="note">
            {copy.transactionId}: {result.transaction.id}
          </p>
        </div>
      )}
    </form>
  );
};
