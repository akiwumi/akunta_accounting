"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type VatFilingActionProps = {
  locale: Locale;
  periodKey: string;
  /** False while the period is still running: it cannot have been filed yet. */
  enabled: boolean;
};

export const VatFilingAction = ({ locale, periodKey, enabled }: VatFilingActionProps) => {
  const router = useRouter();
  const [lock, setLock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const copy =
    locale === "sv"
      ? {
          lock: "Lås perioden så att inget mer kan bokföras i den",
          lockHelp:
            "Rekommenderas. Då stämmer bokföringen alltid med det du har lämnat in. En rättelse efteråt bokförs i den period som är öppen.",
          button: "Jag har lämnat in den",
          saving: "Sparar...",
          notYet: "Perioden är inte slut ännu, så den kan inte vara inlämnad.",
          failed: "Det gick inte att spara. Försök igen.",
          lockFailed: "Deklarationen är sparad som inlämnad, men perioden kunde inte låsas:"
        }
      : {
          lock: "Lock the period so nothing more can be booked into it",
          lockHelp:
            "Recommended. Your books then always match what you filed. A later correction is booked in the period that is open.",
          button: "I have filed this",
          saving: "Saving...",
          notYet: "The period has not ended yet, so it cannot have been filed.",
          failed: "Could not save. Please try again.",
          lockFailed: "The return is saved as filed, but the period could not be locked:"
        };

  const onFile = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/vat-return/filed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: periodKey, lock })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; lockError?: string | null };
      if (!response.ok) throw new Error(json.error ?? copy.failed);
      if (json.lockError) setNotice(`${copy.lockFailed} ${json.lockError}`);
      router.refresh();
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : copy.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <input
          type="checkbox"
          checked={lock}
          disabled={saving || !enabled}
          onChange={(event) => setLock(event.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>
          {copy.lock}
          <span className="note" style={{ display: "block" }}>
            {copy.lockHelp}
          </span>
        </span>
      </label>
      <div className="row">
        <button type="button" onClick={onFile} disabled={saving || !enabled}>
          {saving ? copy.saving : copy.button}
        </button>
      </div>
      {!enabled && <p className="note">{copy.notYet}</p>}
      {notice && <p className="note">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
};
