"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CustomerPicker } from "@/components/invoices/CustomerPicker";
import { LineItemsEditor } from "@/components/invoices/LineItemsEditor";
import {
  type CustomerDraft,
  type CustomerOption,
  customerPayload,
  draftsToItems,
  emptyCustomer,
  type LineItemDraft,
  makeLineItem,
  totalsOfDrafts
} from "@/lib/invoices/drafts";
import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

export type QuoteFormInitial = {
  customer: CustomerDraft;
  projectName: string;
  description: string;
  notes: string;
  issueDate: string;
  validUntil: string;
  currency: string;
  items: LineItemDraft[];
};

type QuoteFormProps = {
  locale: Locale;
  /** Set when editing an existing quote. */
  quoteId?: string;
  quoteNumber?: string;
  initial?: QuoteFormInitial;
  customers: CustomerOption[];
  vatRegistered: boolean;
  defaultCurrency: string;
  prefillCustomer?: CustomerDraft | null;
};

const localIso = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const addDaysIso = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const QuoteForm = ({
  locale,
  quoteId,
  quoteNumber,
  initial,
  customers,
  vatRegistered,
  defaultCurrency,
  prefillCustomer
}: QuoteFormProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const editing = Boolean(quoteId);
  const today = localIso(new Date());

  const [customer, setCustomer] = useState<CustomerDraft>(initial?.customer ?? prefillCustomer ?? emptyCustomer());
  const [projectName, setProjectName] = useState(initial?.projectName ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? today);
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? addDaysIso(today, 30));
  const [currency, setCurrency] = useState(initial?.currency ?? defaultCurrency);
  const [items, setItems] = useState<LineItemDraft[]>(() => initial?.items ?? [makeLineItem(vatRegistered)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const totals = useMemo(() => totalsOfDrafts(items), [items]);

  const copy = sv
    ? {
        customer: "Kund",
        lines: "Vad offerten gäller",
        details: "Datum och giltighet",
        issueDate: "Offertdatum",
        validUntil: "Giltig till och med",
        validHint: "Efter det datumet visas offerten som utgången.",
        currency: "Valuta",
        project: "Projekt eller rubrik",
        intro: "Inledande text (valfritt)",
        notes: "Villkor och övrigt (valfritt)",
        notesHint: "Till exempel betalningsvillkor, leveranstid eller att påminnelseavgift tas ut vid sen betalning.",
        subtotal: "Summa exkl. moms",
        vat: "Moms",
        total: "Summa inkl. moms",
        create: "Spara offert",
        save: "Spara ändringar",
        saving: "Sparar...",
        saved: "Offerten är sparad.",
        failed: "Det gick inte att spara offerten."
      }
    : {
        customer: "Customer",
        lines: "What the quote is for",
        details: "Dates and validity",
        issueDate: "Quote date",
        validUntil: "Valid until",
        validHint: "After that date the quote is shown as expired.",
        currency: "Currency",
        project: "Project or heading",
        intro: "Opening text (optional)",
        notes: "Terms and other notes (optional)",
        notesHint: "For example payment terms, delivery time, or that a reminder fee is charged on late payment.",
        subtotal: "Total excl. VAT",
        vat: "VAT",
        total: "Total incl. VAT",
        create: "Save quote",
        save: "Save changes",
        saving: "Saving...",
        saved: "The quote is saved.",
        failed: "The quote could not be saved."
      };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(editing ? `/api/quotes/${quoteId}` : "/api/quotes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: customerPayload(customer),
          projectName: projectName.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined,
          issueDate,
          validUntil: validUntil || undefined,
          currency,
          items: draftsToItems(items)
        })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; quote?: { id: string } };
      if (!response.ok || !json.quote) throw new Error(json.error || copy.failed);

      if (editing) {
        setSuccess(copy.saved);
        router.refresh();
      } else {
        router.push(`/quotes/${json.quote.id}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="invoiceBuilder" onSubmit={submit}>
      {quoteNumber && <p className="note">{quoteNumber}</p>}

      <details open>
        <summary>{copy.customer}</summary>
        <div className="invoiceSectionBody">
          <CustomerPicker locale={locale} value={customer} onChange={setCustomer} options={customers} />
        </div>
      </details>

      <details open>
        <summary>{copy.lines}</summary>
        <div className="stack invoiceSectionBody">
          <label className="stack">
            {copy.project}
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={180} />
          </label>
          <LineItemsEditor
            locale={locale}
            items={items}
            onChange={setItems}
            currency={currency}
            vatRegistered={vatRegistered}
          />
        </div>
      </details>

      <details open>
        <summary>{copy.details}</summary>
        <div className="stack invoiceSectionBody">
          <div className="row">
            <label className="stack">
              {copy.issueDate}
              <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
            </label>
            <label className="stack">
              {copy.validUntil}
              <input type="date" value={validUntil} min={issueDate} onChange={(event) => setValidUntil(event.target.value)} />
            </label>
            <label className="stack">
              {copy.currency}
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="SEK">SEK</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
          </div>
          <p className="note">{copy.validHint}</p>
          <label className="stack">
            {copy.intro}
            <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} />
          </label>
          <label className="stack">
            {copy.notes}
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
          </label>
          <p className="note">{copy.notesHint}</p>
        </div>
      </details>

      <div className="invoiceTotals">
        <p>
          {copy.subtotal}: <strong>{formatMoney(totals.subtotal, currency, numberLocale)}</strong>
        </p>
        <p>
          {copy.vat}: <strong>{formatMoney(totals.vatAmount, currency, numberLocale)}</strong>
        </p>
        <p>
          {copy.total}: <strong>{formatMoney(totals.grossAmount, currency, numberLocale)}</strong>
        </p>
      </div>

      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? copy.saving : editing ? copy.save : copy.create}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </form>
  );
};
