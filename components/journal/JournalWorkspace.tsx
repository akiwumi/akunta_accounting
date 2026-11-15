"use client";

import { useState } from "react";

import { FreeEntry } from "@/components/journal/FreeEntry";
import { GuidedEntry } from "@/components/journal/GuidedEntry";
import { type PickerAccount } from "@/components/journal/shared";
import { type Locale } from "@/lib/i18n/locale";

type JournalWorkspaceProps = {
  locale: Locale;
  accounts: PickerAccount[];
  today: string;
  defaultYear: number;
  years: number[];
  defaultVatPeriodEnd: string;
  cashMethod: boolean;
};

/** The two ways into a manual entry: guided situations, or a free debit and credit entry. */
export const JournalWorkspace = (props: JournalWorkspaceProps) => {
  const [mode, setMode] = useState<"guided" | "free">("guided");
  const copy =
    props.locale === "sv"
      ? {
          modes: "Sätt att bokföra",
          guided: "Guidad",
          free: "Fri bokföring",
          freeTitle: "Fri bokföringsorder",
          freeHelp:
            "För dig som kan bokföring. Välj konton och skriv belopp i debet eller kredit. Posten kan bokföras först när debet och kredit är lika stora."
        }
      : {
          modes: "Ways to book",
          guided: "Guided",
          free: "Free entry",
          freeTitle: "Free journal entry",
          freeHelp:
            "For those who know bookkeeping. Choose accounts and write amounts as debit or credit. The entry can be booked only when debit and credit are equal."
        };

  return (
    <article className="card stack" style={{ gap: 22, padding: 24 }}>
      <div className="row" role="group" aria-label={copy.modes}>
        <button
          type="button"
          className={mode === "guided" ? undefined : "secondary"}
          aria-pressed={mode === "guided"}
          onClick={() => setMode("guided")}
        >
          {copy.guided}
        </button>
        <button
          type="button"
          className={mode === "free" ? undefined : "secondary"}
          aria-pressed={mode === "free"}
          onClick={() => setMode("free")}
        >
          {copy.free}
        </button>
      </div>

      {mode === "guided" ? (
        <GuidedEntry {...props} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h2 style={{ margin: 0 }}>{copy.freeTitle}</h2>
            <p className="note" style={{ maxWidth: "76ch" }}>{copy.freeHelp}</p>
          </div>
          <FreeEntry locale={props.locale} accounts={props.accounts} today={props.today} />
        </div>
      )}
    </article>
  );
};
