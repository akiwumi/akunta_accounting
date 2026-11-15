"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney } from "@/lib/data/format";
import { type RecurringState } from "@/lib/invoices/recurring";
import { type Locale } from "@/lib/i18n/locale";

export type RecurringRow = {
  id: string;
  customerId: string | null;
  customerName: string;
  description: string | null;
  frequency: string;
  nextRunDate: string;
  endDate: string | null;
  autoSend: boolean;
  state: RecurringState;
  currency: string;
  grossAmount: number;
  invoiceCount: number;
};

type RecurringListProps = { locale: Locale; rows: RecurringRow[] };

export const RecurringList = ({ locale, rows }: RecurringListProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = sv
    ? {
        title: "Återkommande fakturor",
        empty:
          "Inga återkommande fakturor ännu. Öppna en faktura och välj Upprepa fakturan, så skapas nästa automatiskt.",
        customer: "Kund",
        what: "Gäller",
        amount: "Belopp",
        how: "Hur ofta",
        next: "Nästa faktura",
        status: "Status",
        action: "Åtgärd",
        frequency: { MONTHLY: "Varje månad", QUARTERLY: "Varje kvartal", YEARLY: "Varje år" } as Record<string, string>,
        state: { ACTIVE: "Aktiv", PAUSED: "Pausad", ENDED: "Avslutad" } as Record<RecurringState, string>,
        autoSend: "skickas automatiskt",
        manualSend: "skapas som utkast",
        until: "till och med",
        created: (n: number) => (n === 1 ? "1 faktura skapad" : `${n} fakturor skapade`),
        pause: "Pausa",
        resume: "Återuppta",
        stop: "Avsluta",
        confirmStop: "Avsluta för gott? Fakturor som redan skapats finns kvar.",
        yesStop: "Ja, avsluta",
        cancel: "Avbryt",
        failed: "Det gick inte att ändra. Försök igen."
      }
    : {
        title: "Recurring invoices",
        empty: "No recurring invoices yet. Open an invoice and choose Repeat this invoice, and the next one is created automatically.",
        customer: "Customer",
        what: "For",
        amount: "Amount",
        how: "How often",
        next: "Next invoice",
        status: "Status",
        action: "Action",
        frequency: { MONTHLY: "Every month", QUARTERLY: "Every quarter", YEARLY: "Every year" } as Record<string, string>,
        state: { ACTIVE: "Active", PAUSED: "Paused", ENDED: "Ended" } as Record<RecurringState, string>,
        autoSend: "sent automatically",
        manualSend: "created as a draft",
        until: "until",
        created: (n: number) => (n === 1 ? "1 invoice created" : `${n} invoices created`),
        pause: "Pause",
        resume: "Resume",
        stop: "Stop",
        confirmStop: "Stop for good? Invoices already created are kept.",
        yesStop: "Yes, stop",
        cancel: "Cancel",
        failed: "The change could not be made. Please try again."
      };

  const act = async (id: string, action: "pause" | "resume" | "stop") => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/recurring-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || copy.failed);
      }
      setConfirmStopId(null);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : copy.failed);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <article className="card" id="recurring-invoices">
      <h2>{copy.title}</h2>
      {rows.length === 0 ? (
        <p className="note">{copy.empty}</p>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.customer}</th>
                <th>{copy.what}</th>
                <th>{copy.amount}</th>
                <th>{copy.how}</th>
                <th>{copy.next}</th>
                <th>{copy.status}</th>
                <th>{copy.action}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.customerId ? (
                      <Link className="textLink" href={`/customers/${row.customerId}`}>
                        {row.customerName}
                      </Link>
                    ) : (
                      row.customerName
                    )}
                  </td>
                  <td>
                    {row.description || "-"}
                    <br />
                    <span className="note">{copy.created(row.invoiceCount)}</span>
                  </td>
                  <td>{formatMoney(row.grossAmount, row.currency, numberLocale)}</td>
                  <td>
                    {copy.frequency[row.frequency] ?? row.frequency}
                    <br />
                    <span className="note">{row.autoSend ? copy.autoSend : copy.manualSend}</span>
                  </td>
                  <td>
                    {row.state === "ENDED" ? "-" : row.nextRunDate.slice(0, 10)}
                    {row.endDate && row.state !== "ENDED" && (
                      <>
                        <br />
                        <span className="note">
                          {copy.until} {row.endDate.slice(0, 10)}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={row.state === "ACTIVE" ? "badge good" : "badge"}>{copy.state[row.state]}</span>
                  </td>
                  <td>
                    {confirmStopId === row.id ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className="note">{copy.confirmStop}</span>
                        <div className="row">
                          <button type="button" disabled={busyId === row.id} onClick={() => void act(row.id, "stop")}>
                            {copy.yesStop}
                          </button>
                          <button type="button" className="secondary" onClick={() => setConfirmStopId(null)}>
                            {copy.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="row">
                        {row.state === "ACTIVE" && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyId === row.id}
                            onClick={() => void act(row.id, "pause")}
                          >
                            {copy.pause}
                          </button>
                        )}
                        {row.state !== "ACTIVE" && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyId === row.id}
                            onClick={() => void act(row.id, "resume")}
                          >
                            {copy.resume}
                          </button>
                        )}
                        {row.state !== "ENDED" && (
                          <button type="button" className="secondary" onClick={() => setConfirmStopId(row.id)}>
                            {copy.stop}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
};
