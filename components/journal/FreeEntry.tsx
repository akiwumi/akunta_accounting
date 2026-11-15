"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { AccountPicker } from "@/components/journal/AccountPicker";
import { EntryPreview } from "@/components/journal/EntryPreview";
import {
  booksVatOutsideSettlement,
  journalErrorText,
  parseAmount,
  toOre,
  type PickerAccount,
  type PreviewEntryView
} from "@/components/journal/shared";
import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

type FreeEntryProps = {
  locale: Locale;
  accounts: PickerAccount[];
  today: string;
};

type Line = { key: number; accountId: string; debit: string; credit: string };

type Saved = { verificationNumber: number; description: string };

/**
 * Free journal entry for people who know bookkeeping: date, text and any
 * number of lines. Save is enabled only when debit equals credit.
 */
export const FreeEntry = ({ locale, accounts, today }: FreeEntryProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");
  const copy = sv
    ? {
        date: "Datum",
        text: "Text",
        textPlaceholder: "Vad gäller bokföringen?",
        reference: "Referens (valfritt)",
        account: "Konto",
        accountPlaceholder: "Sök på nummer eller namn",
        noMatch: "Inget konto matchar. Lägg till konton under Kontoplan.",
        debit: "Debet",
        credit: "Kredit",
        line: (n: number) => `Rad ${n}`,
        remove: "Ta bort rad",
        addLine: "Lägg till rad",
        totals: "Summa",
        balanced: "Balanserar",
        difference: (amount: string, side: string) => `Differens ${amount}: ${side}`,
        debitLarger: "debet är större",
        creditLarger: "kredit är större",
        empty: "Fyll i minst två rader",
        keys: "Tangentbord: Enter går till nästa rad, likhetstecken (=) fyller i det belopp som saknas, Ctrl eller Cmd + Enter bokför.",
        invalidAmount: "Skriv belopp med siffror, till exempel 1 250,50.",
        vatTitle: "Den här bokföringen rör ett momskonto",
        vatBody:
          "Moms som bokförs här kommer inte med i momsdeklarationen, och kontrollen mot momskontona kommer att visa en skillnad. Försäljning och inköp med moms ska läggas in som kvitto, betalning eller faktura. Då hamnar momsen i rätt ruta. Ska du bokföra en momsbetalning till Skatteverket, använd den guidade händelsen i stället.",
        vatConfirm: "Jag förstår och vill bokföra ändå",
        save: "Bokför",
        saving: "Bokför...",
        failed: "Det gick inte att bokföra. Försök igen.",
        saved: (n: number) => `Bokfört som verifikation ${n}.`,
        seeLedger: "Visa i huvudboken",
        freeEffect: "Kontrollera raderna. När du bokför får posten ett verifikationsnummer och kan sedan bara rättas med en ny, omvänd post."
      }
    : {
        date: "Date",
        text: "Text",
        textPlaceholder: "What is the entry about?",
        reference: "Reference (optional)",
        account: "Account",
        accountPlaceholder: "Search by number or name",
        noMatch: "No account matches. Add accounts under Chart of accounts.",
        debit: "Debit",
        credit: "Credit",
        line: (n: number) => `Line ${n}`,
        remove: "Remove line",
        addLine: "Add line",
        totals: "Total",
        balanced: "Balanced",
        difference: (amount: string, side: string) => `Difference ${amount}: ${side}`,
        debitLarger: "debit is larger",
        creditLarger: "credit is larger",
        empty: "Fill in at least two lines",
        keys: "Keyboard: Enter moves to the next line, the equals sign (=) fills in the missing amount, Ctrl or Cmd + Enter books the entry.",
        invalidAmount: "Write amounts with digits only, for example 1250.50.",
        vatTitle: "This entry books on a VAT account",
        vatBody:
          "VAT booked here does not reach the VAT return, and the check against the VAT accounts will show a difference. Sales and purchases with VAT should be entered as a receipt, payment or invoice. The VAT then lands in the right box. To book a VAT payment to Skatteverket, use the guided situation instead.",
        vatConfirm: "I understand and want to book it anyway",
        save: "Book entry",
        saving: "Booking...",
        failed: "The entry could not be booked. Please try again.",
        saved: (n: number) => `Booked as verification ${n}.`,
        seeLedger: "Show in the ledger",
        freeEffect: "Check the lines. Once booked, the entry gets a verification number and can only be corrected with a new, reversing entry."
      };

  const nextKey = useRef(3);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { key: 1, accountId: "", debit: "", credit: "" },
    { key: 2, accountId: "", debit: "", credit: "" }
  ]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const pickers = useRef(new Map<number, HTMLInputElement | null>());
  const focusKey = useRef<number | null>(null);

  // Focus the account field of a line that was just added from the keyboard.
  useEffect(() => {
    if (focusKey.current === null) return;
    pickers.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  }, [lines.length]);

  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const parsed = lines.map((line) => {
    const debit = parseAmount(line.debit);
    const credit = parseAmount(line.credit);
    const invalid = Number.isNaN(debit) || Number.isNaN(credit);
    const debitOre = debit && Number.isFinite(debit) ? toOre(debit) : 0;
    const creditOre = credit && Number.isFinite(credit) ? toOre(credit) : 0;
    const blank = !line.accountId && line.debit.trim() === "" && line.credit.trim() === "";
    const complete = Boolean(line.accountId) && !invalid && debitOre + creditOre > 0;
    return { line, debitOre, creditOre, invalid, blank, complete };
  });

  const totalDebitOre = parsed.reduce((sum, row) => sum + row.debitOre, 0);
  const totalCreditOre = parsed.reduce((sum, row) => sum + row.creditOre, 0);
  const differenceOre = totalDebitOre - totalCreditOre;
  const filled = parsed.filter((row) => !row.blank);
  const allComplete = filled.length >= 2 && filled.every((row) => row.complete);
  const anyInvalid = parsed.some((row) => row.invalid);
  const balanced = allComplete && differenceOre === 0 && totalDebitOre > 0;

  const codes = filled.map((row) => accountById.get(row.line.accountId)?.code ?? "");
  const vatWarning = booksVatOutsideSettlement(codes);
  const canSave =
    balanced && description.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!vatWarning || acknowledged) && !saving;

  const preview: PreviewEntryView[] =
    filled.filter((row) => row.complete).length >= 2
      ? [
          {
            txnDate: date,
            description: description.trim() || copy.textPlaceholder,
            lines: filled
              .filter((row) => row.complete)
              .map((row) => {
                const account = accountById.get(row.line.accountId)!;
                return {
                  code: account.code,
                  name: account.name,
                  type: account.type,
                  debit: row.debitOre / 100,
                  credit: row.creditOre / 100
                };
              })
          }
        ]
      : [];

  const update = (key: number, patch: Partial<Line>) => {
    setSaved(null);
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const addLine = (focus: boolean) => {
    const key = nextKey.current++;
    if (focus) focusKey.current = key;
    setLines((current) => [...current, { key, accountId: "", debit: "", credit: "" }]);
  };

  const removeLine = (key: number) => {
    setLines((current) => (current.length <= 2 ? current : current.filter((line) => line.key !== key)));
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "free",
          date,
          description: description.trim(),
          reference: reference.trim() || undefined,
          acknowledgeVatWarning: vatWarning && acknowledged,
          lines: filled.map((row) => ({
            accountId: row.line.accountId,
            debit: row.debitOre / 100,
            credit: row.creditOre / 100
          }))
        })
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        entries?: Array<{ verificationNumber: number; description: string }>;
      };
      if (!response.ok || !json.entries?.[0]) {
        throw new Error(journalErrorText(sv, json.code, json.error ?? copy.failed));
      }
      setSaved(json.entries[0]);
      setDescription("");
      setReference("");
      setAcknowledged(false);
      nextKey.current += 2;
      setLines([
        { key: nextKey.current - 2, accountId: "", debit: "", credit: "" },
        { key: nextKey.current - 1, accountId: "", debit: "", credit: "" }
      ]);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.failed);
    } finally {
      setSaving(false);
    }
  };

  const onAmountKey = (event: KeyboardEvent<HTMLInputElement>, index: number, side: "debit" | "credit") => {
    const line = lines[index];
    if (event.key === "=") {
      // Fill in what is missing for the entry to balance, on this side of this line.
      event.preventDefault();
      const row = parsed[index];
      const others = differenceOre - row.debitOre + row.creditOre;
      const missing = side === "debit" ? -others : others;
      if (missing > 0) {
        const value = (missing / 100).toFixed(2).replace(".", sv ? "," : ".");
        update(line.key, side === "debit" ? { debit: value, credit: "" } : { credit: value, debit: "" });
      }
      return;
    }
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const next = lines[index + 1];
      if (next) pickers.current.get(next.key)?.focus();
      else addLine(true);
    }
  };

  const amountStyle = { width: "100%", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };
  const gridColumns = "minmax(160px, 1fr) minmax(84px, 140px) minmax(84px, 140px) 44px";

  return (
    <div
      className="stack"
      style={{ gap: 20 }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label className="stack" style={{ flex: "0 1 180px" }}>
          {copy.date}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="stack" style={{ flex: "2 1 320px" }}>
          {copy.text}
          <input
            type="text"
            value={description}
            maxLength={200}
            placeholder={copy.textPlaceholder}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="stack" style={{ flex: "1 1 180px" }}>
          {copy.reference}
          <input type="text" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
        </label>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: gridColumns, gap: 10 }} aria-hidden="true">
          <span className="label">{copy.account}</span>
          <span className="label" style={{ textAlign: "right" }}>{copy.debit}</span>
          <span className="label" style={{ textAlign: "right" }}>{copy.credit}</span>
          <span />
        </div>

        {lines.map((line, index) => (
          <div
            key={line.key}
            role="group"
            aria-label={copy.line(index + 1)}
            style={{ display: "grid", gridTemplateColumns: gridColumns, gap: 10, alignItems: "center" }}
          >
            <AccountPicker
              accounts={accounts}
              value={line.accountId}
              onChange={(accountId) => update(line.key, { accountId })}
              ariaLabel={`${copy.line(index + 1)}: ${copy.account}`}
              placeholder={copy.accountPlaceholder}
              noMatch={copy.noMatch}
              inputRef={(element) => {
                pickers.current.set(line.key, element);
              }}
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={`${copy.line(index + 1)}: ${copy.debit}`}
              aria-invalid={Number.isNaN(parseAmount(line.debit))}
              value={line.debit}
              style={amountStyle}
              onChange={(event) => update(line.key, { debit: event.target.value, ...(event.target.value ? { credit: "" } : {}) })}
              onKeyDown={(event) => onAmountKey(event, index, "debit")}
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={`${copy.line(index + 1)}: ${copy.credit}`}
              aria-invalid={Number.isNaN(parseAmount(line.credit))}
              value={line.credit}
              style={amountStyle}
              onChange={(event) => update(line.key, { credit: event.target.value, ...(event.target.value ? { debit: "" } : {}) })}
              onKeyDown={(event) => onAmountKey(event, index, "credit")}
            />
            <button
              type="button"
              className="tertiary"
              aria-label={`${copy.remove} ${index + 1}`}
              title={copy.remove}
              disabled={lines.length <= 2}
              onClick={() => removeLine(line.key)}
              style={{ justifyContent: "center" }}
            >
              ×
            </button>
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: gridColumns, gap: 10, alignItems: "center", paddingTop: 6 }}>
          <div className="row">
            <button type="button" className="secondary" onClick={() => addLine(true)}>
              {copy.addLine}
            </button>
            <span className="label">{copy.totals}</span>
          </div>
          <strong style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totalDebitOre / 100)}</strong>
          <strong style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totalCreditOre / 100)}</strong>
          <span />
        </div>

        <div className="row" role="status">
          {filled.length < 2 || totalDebitOre + totalCreditOre === 0 ? (
            <span className="badge">{copy.empty}</span>
          ) : differenceOre === 0 ? (
            <span className="badge good">{copy.balanced}</span>
          ) : (
            <span className="badge warn">
              {copy.difference(money(Math.abs(differenceOre) / 100), differenceOre > 0 ? copy.debitLarger : copy.creditLarger)}
            </span>
          )}
          {anyInvalid ? <span className="error">{copy.invalidAmount}</span> : null}
        </div>
        <p className="note">{copy.keys}</p>
      </div>

      {vatWarning ? (
        <div className="stack" role="alert" style={{ gap: 8, padding: 16, borderRadius: 12, background: "#fff5e8" }}>
          <strong style={{ color: "var(--warn)" }}>{copy.vatTitle}</strong>
          <p style={{ margin: 0, maxWidth: "80ch" }}>{copy.vatBody}</p>
          <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              style={{ marginTop: 4 }}
            />
            <span>{copy.vatConfirm}</span>
          </label>
        </div>
      ) : null}

      {preview.length > 0 ? <EntryPreview locale={locale} entries={preview} effect={copy.freeEffect} /> : null}

      <div className="row">
        <button type="button" disabled={!canSave} onClick={() => void save()}>
          {saving ? copy.saving : copy.save}
        </button>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {saved ? (
          <p className="success" role="status">
            {copy.saved(saved.verificationNumber)}{" "}
            <Link className="textLink" href="/ledger?source=JOURNAL">
              {copy.seeLedger}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
};
