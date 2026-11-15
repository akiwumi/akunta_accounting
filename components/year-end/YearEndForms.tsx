"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type Patch = Record<string, unknown>;

/** Saves answers for the year and reloads the server-rendered page so every figure is recomputed. */
const useSaveInputs = (year: number, failed: string) => {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (patch: Patch) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/year-end/inputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, ...patch })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? failed);
      setSaved(true);
      router.refresh();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : failed);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { save, saving, error, saved };
};

/** "1 234,50" and "1234.5" both mean 1234.5. Empty means no answer. */
const parseAmount = (raw: string): number | null | "invalid" => {
  const cleaned = raw.replace(/[\s ]/g, "").replace(/kr$/i, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return "invalid";
  return Number(cleaned);
};

const shared = (locale: Locale) =>
  locale === "sv"
    ? { save: "Spara", saving: "Sparar...", saved: "Sparat.", failed: "Kunde inte spara.", invalid: "Skriv ett belopp med siffror, till exempel 1250." }
    : { save: "Save", saving: "Saving...", saved: "Saved.", failed: "Could not save.", invalid: "Enter an amount in digits, for example 1250." };

// ─── Bank statement balance ───────────────────────────────────────────────────

export const BankBalanceForm = ({
  locale,
  year,
  initial
}: {
  locale: Locale;
  year: number;
  initial: number | null;
}) => {
  const text = shared(locale);
  const copy =
    locale === "sv"
      ? { label: `Saldo på kontoutdraget den 31 december ${year}`, placeholder: "t.ex. 48 250,75" }
      : { label: `Balance on the bank statement on 31 December ${year}`, placeholder: "e.g. 48 250.75" };
  const { save, saving, error, saved } = useSaveInputs(year, text.failed);
  const [value, setValue] = useState(initial === null ? "" : String(initial).replace(".", locale === "sv" ? "," : "."));
  const [invalid, setInvalid] = useState(false);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseAmount(value);
        if (parsed === "invalid") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void save({ bankStatementBalance: parsed });
      }}
    >
      <div className="row">
        <label className="stack">
          <span className="label">{copy.label}</span>
          <input inputMode="decimal" value={value} placeholder={copy.placeholder} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? text.saving : text.save}
        </button>
      </div>
      {invalid && <p className="error">{text.invalid}</p>}
      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="success">{text.saved}</p>}
    </form>
  );
};

// ─── Confirming a step the app has no data for ────────────────────────────────

export const ConfirmStepButton = ({
  locale,
  year,
  field,
  confirmed,
  label,
  undoLabel
}: {
  locale: Locale;
  year: number;
  field: "supplierBills" | "customerInvoices";
  confirmed: boolean;
  label: string;
  undoLabel: string;
}) => {
  const text = shared(locale);
  const { save, saving, error } = useSaveInputs(year, text.failed);
  return (
    <div className="stack">
      <div className="row">
        <button
          type="button"
          className={confirmed ? "secondary" : undefined}
          disabled={saving}
          onClick={() => void save({ confirmed: { [field]: !confirmed } })}
        >
          {saving ? text.saving : confirmed ? undoLabel : label}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
};

// ─── The user's own figures for the NE-bilaga ─────────────────────────────────

export type OwnFigureField = { id: string; number: string; label: string; help: string; sign: "+" | "-"; value: number | null };

export const OwnFiguresForm = ({
  locale,
  year,
  common,
  rare
}: {
  locale: Locale;
  year: number;
  common: OwnFigureField[];
  rare: OwnFigureField[];
}) => {
  const text = shared(locale);
  const copy =
    locale === "sv"
      ? {
          rare: "Mindre vanliga rutor (skog, fastighet, räntefördelning, gemensam verksamhet)",
          adds: "läggs till",
          deducts: "dras av",
          empty: "Lämna tomt om det inte gäller dig.",
          save: "Spara och räkna om"
        }
      : {
          rare: "Less common boxes (forestry, property, interest allocation, shared business)",
          adds: "added",
          deducts: "deducted",
          empty: "Leave empty if it does not apply to you.",
          save: "Save and recalculate"
        };
  const { save, saving, error, saved } = useSaveInputs(year, text.failed);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...common, ...rare].map((field) => [field.id, field.value === null ? "" : String(field.value)]))
  );
  const [invalid, setInvalid] = useState<string | null>(null);

  const renderField = (field: OwnFigureField) => (
    <label className="stack" key={field.id}>
      <span>
        <strong>{field.number}</strong> {field.label}{" "}
        <span className="note" style={{ display: "inline" }}>
          ({field.sign === "+" ? copy.adds : copy.deducts})
        </span>
      </span>
      <span className="note">{field.help}</span>
      <input
        inputMode="numeric"
        value={values[field.id] ?? ""}
        placeholder="0"
        aria-invalid={invalid === field.id}
        onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
        style={{ maxWidth: 220 }}
      />
    </label>
  );

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        const manual: Record<string, number | null> = {};
        for (const field of [...common, ...rare]) {
          const parsed = parseAmount(values[field.id] ?? "");
          if (parsed === "invalid" || (typeof parsed === "number" && parsed < 0)) {
            setInvalid(field.id);
            return;
          }
          manual[field.id] = parsed === null ? null : Math.round(parsed);
        }
        setInvalid(null);
        void save({ manual });
      }}
    >
      <p className="note">{copy.empty}</p>
      {common.map(renderField)}
      <details>
        <summary>{copy.rare}</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          {rare.map(renderField)}
        </div>
      </details>
      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? text.saving : copy.save}
        </button>
      </div>
      {invalid && <p className="error">{text.invalid}</p>}
      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="success">{text.saved}</p>}
    </form>
  );
};

// ─── Details that go into the SRU files ───────────────────────────────────────

export type SruDetails = {
  name: string;
  personnummer: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  activity: string;
  helped: "yes" | "no" | "";
};

export const SruDetailsForm = ({ locale, year, initial }: { locale: Locale; year: number; initial: SruDetails }) => {
  const text = shared(locale);
  const copy =
    locale === "sv"
      ? {
          name: "Ditt för- och efternamn",
          personnummer: "Personnummer",
          personnummerHint: "ÅÅÅÅMMDD-XXXX",
          address: "Adress (frivilligt)",
          postalCode: "Postnummer",
          city: "Postort",
          email: "E-post (frivilligt)",
          activity: "Vad gör verksamheten? (frivilligt)",
          activityHint: "Till exempel datakonsult, frisör eller webbutik.",
          helped: "Har en redovisningskonsult eller revisor hjälpt till med bokslutet mot betalning?",
          helpedUnset: "Svara hos Skatteverket",
          yes: "Ja",
          no: "Nej, jag har gjort det själv",
          save: "Spara uppgifterna"
        }
      : {
          name: "Your first and last name",
          personnummer: "Personal identity number (personnummer)",
          personnummerHint: "YYYYMMDD-XXXX",
          address: "Address (optional)",
          postalCode: "Postcode",
          city: "Town",
          email: "Email (optional)",
          activity: "What does the business do? (optional)",
          activityHint: "For example IT consultant, hairdresser or web shop.",
          helped: "Did a paid accountant or auditor help prepare the year-end accounts?",
          helpedUnset: "Answer at Skatteverket",
          yes: "Yes",
          no: "No, I did it myself",
          save: "Save details"
        };
  const { save, saving, error, saved } = useSaveInputs(year, text.failed);
  const [form, setForm] = useState(initial);
  const set = (key: keyof SruDetails) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          submitter: {
            name: form.name,
            personnummer: form.personnummer,
            address: form.address,
            postalCode: form.postalCode,
            city: form.city,
            email: form.email
          },
          general: { activity: form.activity, helped: form.helped === "" ? null : form.helped }
        });
      }}
    >
      <div className="row">
        <label className="stack">
          <span className="label">{copy.name}</span>
          <input value={form.name} onChange={set("name")} autoComplete="name" maxLength={250} />
        </label>
        <label className="stack">
          <span className="label">{copy.personnummer}</span>
          <input value={form.personnummer} onChange={set("personnummer")} placeholder={copy.personnummerHint} maxLength={20} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          <span className="label">{copy.address}</span>
          <input value={form.address} onChange={set("address")} autoComplete="street-address" maxLength={250} />
        </label>
        <label className="stack">
          <span className="label">{copy.postalCode}</span>
          <input value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" autoComplete="postal-code" maxLength={10} />
        </label>
        <label className="stack">
          <span className="label">{copy.city}</span>
          <input value={form.city} onChange={set("city")} autoComplete="address-level2" maxLength={250} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          <span className="label">{copy.email}</span>
          <input type="email" value={form.email} onChange={set("email")} autoComplete="email" maxLength={250} />
        </label>
        <label className="stack">
          <span className="label">{copy.activity}</span>
          <input value={form.activity} onChange={set("activity")} placeholder={copy.activityHint} maxLength={80} />
        </label>
      </div>
      <label className="stack">
        <span className="label">{copy.helped}</span>
        <select value={form.helped} onChange={set("helped")} style={{ maxWidth: 320 }}>
          <option value="">{copy.helpedUnset}</option>
          <option value="no">{copy.no}</option>
          <option value="yes">{copy.yes}</option>
        </select>
      </label>
      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? text.saving : copy.save}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="success">{text.saved}</p>}
    </form>
  );
};

// ─── Closing the year ─────────────────────────────────────────────────────────

export const CloseYearButton = ({
  locale,
  year,
  openSteps,
  disabled
}: {
  locale: Locale;
  year: number;
  openSteps: number;
  disabled: boolean;
}) => {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy =
    locale === "sv"
      ? {
          start: `Stäng ${year}`,
          question: `Stänga räkenskapsåret ${year}?`,
          consequence: `Året låses: inget kan längre bokföras eller ändras i ${year}. Saldona förs över som ingående balanser till ${year + 1}. Hittar du ett fel senare rättar du det med en ny verifikation i ${year + 1}.`,
          openSteps: `${openSteps} steg ovan är inte klara. Du kan stänga ändå, men kontrollera dem först om du kan.`,
          confirm: `Ja, stäng ${year}`,
          cancel: "Avbryt",
          working: "Stänger året...",
          failed: "Året kunde inte stängas."
        }
      : {
          start: `Close ${year}`,
          question: `Close fiscal year ${year}?`,
          consequence: `The year is locked: nothing can be booked or changed in ${year} any more. The balances are carried forward as opening balances for ${year + 1}. If you find a mistake later you correct it with a new entry in ${year + 1}.`,
          openSteps: `${openSteps} steps above are not done. You can still close, but check them first if you can.`,
          confirm: `Yes, close ${year}`,
          cancel: "Cancel",
          working: "Closing the year...",
          failed: "The year could not be closed."
        };

  const close = async () => {
    setClosing(true);
    setError(null);
    try {
      const response = await fetch("/api/year-end/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear: year })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? copy.failed);
      setConfirming(false);
      router.refresh();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : copy.failed);
    } finally {
      setClosing(false);
    }
  };

  if (!confirming) {
    return (
      <div className="row">
        <button type="button" disabled={disabled} onClick={() => setConfirming(true)}>
          {copy.start}
        </button>
      </div>
    );
  }

  return (
    <div className="stack" role="alertdialog" aria-label={copy.question}>
      <p>
        <strong>{copy.question}</strong>
      </p>
      <p className="note">{copy.consequence}</p>
      {openSteps > 0 && <p className="note">{copy.openSteps}</p>}
      <div className="row">
        <button type="button" disabled={closing} onClick={() => void close()}>
          {closing ? copy.working : copy.confirm}
        </button>
        <button type="button" className="secondary" disabled={closing} onClick={() => setConfirming(false)}>
          {copy.cancel}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
