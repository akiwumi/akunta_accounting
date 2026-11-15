"use client";

import { explainLine, type PreviewEntryView } from "@/components/journal/shared";
import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

type EntryPreviewProps = {
  locale: Locale;
  entries: PreviewEntryView[];
  /** One or two plain sentences about what the entry means for the business. */
  effect?: string;
};

/**
 * "This is what will be booked": every line with its account, the debit or
 * credit amount and, in words, what the line does.
 */
export const EntryPreview = ({ locale, entries, effect }: EntryPreviewProps) => {
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");
  const copy = sv
    ? {
        heading: "Det här bokförs",
        account: "Konto",
        debit: "Debet",
        credit: "Kredit",
        words: "Med ord",
        sum: "Summa",
        isNew: "nytt konto",
        isNewHelp: "Kontot finns inte i din kontoplan ännu. Det läggs till när du bokför.",
        reversal: "Återföring",
        inVat: "Kommer med i momsdeklarationen",
        locked: "Datumet ligger i en låst period. Den här posten kan inte bokföras.",
        help: "Debet och kredit är bokföringens två kolumner. Varje händelse bokförs på minst två konton, och summan i debet är alltid lika stor som summan i kredit."
      }
    : {
        heading: "This is what will be booked",
        account: "Account",
        debit: "Debit",
        credit: "Credit",
        words: "In words",
        sum: "Total",
        isNew: "new account",
        isNewHelp: "This account is not in your chart of accounts yet. It is added when you book the entry.",
        reversal: "Reversal",
        inVat: "Included in the VAT return",
        locked: "The date falls in a locked period. This entry cannot be booked.",
        help: "Debit and credit are the two columns of bookkeeping. Every event is booked on at least two accounts, and the debit total always equals the credit total."
      };

  if (entries.length === 0) return null;

  return (
    <div className="stack" aria-live="polite">
      <div className="stack" style={{ gap: 4 }}>
        <h3 style={{ margin: 0 }}>{copy.heading}</h3>
        {effect ? <p style={{ margin: 0, maxWidth: "70ch" }}>{effect}</p> : null}
      </div>

      {entries.map((entry, index) => {
        const totalDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
        const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
        return (
          <div className="stack" style={{ gap: 6 }} key={`${entry.txnDate}-${index}`}>
            <div className="row" style={{ gap: 8 }}>
              <span className="label">{entry.txnDate}</span>
              <strong>{entry.description}</strong>
              {entry.role === "reversal" ? <span className="badge">{copy.reversal}</span> : null}
              {entry.inVatReturn ? <span className="badge good">{copy.inVat}</span> : null}
            </div>
            {entry.locked ? <p className="error">{copy.locked}</p> : null}
            <div style={{ overflowX: "auto", borderRadius: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.account}</th>
                    <th scope="col" style={{ textAlign: "right" }}>{copy.debit}</th>
                    <th scope="col" style={{ textAlign: "right" }}>{copy.credit}</th>
                    <th scope="col">{copy.words}</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line, lineIndex) => (
                    <tr key={`${line.code}-${lineIndex}`}>
                      <td>
                        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 620 }}>{line.code}</span> {line.name}
                        {line.isNew ? (
                          <>
                            {" "}
                            <span className="badge" title={copy.isNewHelp}>{copy.isNew}</span>
                          </>
                        ) : null}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {line.debit > 0 ? money(line.debit) : ""}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {line.credit > 0 ? money(line.credit) : ""}
                      </td>
                      <td>{explainLine(sv, line, line.debit > 0 ? "debit" : "credit")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{copy.sum}</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(totalDebit)}</th>
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(totalCredit)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      <p className="note" style={{ maxWidth: "80ch" }}>{copy.help}</p>
    </div>
  );
};
