"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type TransactionEditFormProps = {
  transactionId: string;
  locale: Locale;
  initial: {
    description: string;
    txnDate: string;
    reference: string;
  };
};

export const TransactionEditForm = ({ transactionId, locale, initial }: TransactionEditFormProps) => {
  const router = useRouter();
  const copy =
    locale === "sv"
      ? {
          title: "Redigera post",
          description: "Beskrivning",
          date: "Datum",
          reference: "Referens",
          save: "Spara ändringar",
          saving: "Sparar...",
          saved: "Ändringar sparade.",
          failed: "Kunde inte spara ändringar.",
          unknown: "Okänt fel"
        }
      : {
          title: "Edit Entry",
          description: "Description",
          date: "Date",
          reference: "Reference",
          save: "Save changes",
          saving: "Saving...",
          saved: "Changes saved.",
          failed: "Failed to save changes.",
          unknown: "Unknown error"
        };

  const [description, setDescription] = useState(initial.description);
  const [txnDate, setTxnDate] = useState(initial.txnDate);
  const [reference, setReference] = useState(initial.reference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          txnDate,
          reference: reference.trim() || null
        })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? copy.failed);
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
          {copy.description}
          <input value={description} onChange={(event) => setDescription(event.target.value)} required />
        </label>
        <label className="stack">
          {copy.date}
          <input type="date" value={txnDate} onChange={(event) => setTxnDate(event.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          {copy.reference}
          <input value={reference} onChange={(event) => setReference(event.target.value)} />
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
