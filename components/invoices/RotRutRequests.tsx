"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney } from "@/lib/data/format";
import { type RotRutQueueRow } from "@/lib/invoices/rotrut-actions";
import { type Locale } from "@/lib/i18n/locale";

const MAX_PER_FILE = 100;

/**
 * Every ROT/RUT invoice Skatteverket has not paid yet: what is ready to be
 * requested (one file per type and payment year, as Skatteverket requires),
 * what has been sent, and what still waits for the customer.
 */
export const RotRutRequests = ({ locale, rows }: { locale: Locale; rows: RotRutQueueRow[] }) => {
  const router = useRouter();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const copy = sv
    ? {
        title: "Rot och rut: begär utbetalning från Skatteverket",
        intro:
          "När kunden har betalat sin del begär du resten från Skatteverket. Flera fakturor kan skickas i samma fil, men rot och rut går i var sin fil, och bara betalningar från samma år får blandas.",
        group: (type: string, year: number, count: number, total: string) =>
          `${type}, betalda ${year}: ${count === 1 ? "1 faktura" : `${count} fakturor`}, ${total} att begära`,
        deadline: (day: string, days: number) => `Skicka senast ${day} (${days} dagar kvar).`,
        deadlineSoon: (day: string, days: number) => `Snart sista dagen: skicka senast ${day}. ${days} dagar kvar.`,
        deadlinePassed: (day: string) =>
          `Sista dagen var ${day}. Skatteverket betalar inte ut för en begäran som kommer in för sent.`,
        download: "Ladda ner filen",
        downloadPart: (n: number) => `Ladda ner fil ${n}`,
        parts: "En fil rymmer högst 100 köpare, så listan är delad i flera filer. Skicka in alla.",
        how: 'Logga in i Skatteverkets e-tjänst "Rot och rut - företag" med BankID, välj att lämna begäran med en fil, kontrollera uppgifterna och skriv under. Kom sedan tillbaka hit.',
        markSent: "Jag har skickat begäran för de här",
        marked: (n: number) => (n === 1 ? "1 faktura är markerad som skickad." : `${n} fakturor är markerade som skickade.`),
        invoice: "Faktura",
        customer: "Kund",
        buyer: "Personnummer",
        paid: "Kunden betalade",
        amount: "Att begära",
        sentTitle: "Skickade, väntar på utbetalning",
        sent: "Skickad",
        register: "Registrera utbetalning",
        waiting: (n: number, total: string) =>
          `${n === 1 ? "1 faktura väntar" : `${n} fakturor väntar`} på kundens betalning (${total} att begära senare).`,
        working: "Arbetar...",
        failed: "Något gick fel. Försök igen."
      }
    : {
        title: "ROT and RUT: request payout from Skatteverket",
        intro:
          "Once the customer has paid their part, you request the rest from Skatteverket. Several invoices can go in one file, but ROT and RUT go in separate files, and only payments from the same year can be mixed.",
        group: (type: string, year: number, count: number, total: string) =>
          `${type}, paid in ${year}: ${count === 1 ? "1 invoice" : `${count} invoices`}, ${total} to request`,
        deadline: (day: string, days: number) => `Send by ${day} (${days} days left).`,
        deadlineSoon: (day: string, days: number) => `The deadline is close: send by ${day}. ${days} days left.`,
        deadlinePassed: (day: string) => `The deadline was ${day}. Skatteverket does not pay out for a request that arrives late.`,
        download: "Download the file",
        downloadPart: (n: number) => `Download file ${n}`,
        parts: "One file holds at most 100 buyers, so the list is split into several files. Send all of them.",
        how: 'Log in to Skatteverket\'s e-service "Rot och rut - företag" with BankID, choose to submit the request with a file, check the details and sign. Then come back here.',
        markSent: "I have sent the request for these",
        marked: (n: number) => (n === 1 ? "1 invoice is marked as sent." : `${n} invoices are marked as sent.`),
        invoice: "Invoice",
        customer: "Customer",
        buyer: "Personnummer",
        paid: "Customer paid",
        amount: "To request",
        sentTitle: "Sent, waiting for the payout",
        sent: "Sent",
        register: "Register payout",
        waiting: (n: number, total: string) =>
          `${n === 1 ? "1 invoice is" : `${n} invoices are`} waiting for the customer's payment (${total} to request later).`,
        working: "Working...",
        failed: "Something went wrong. Please try again."
      };

  const sum = (list: RotRutQueueRow[]) => list.reduce((total, row) => total + row.deduction, 0);
  const ready = rows.filter((row) => row.stage === "ready");
  const requested = rows.filter((row) => row.stage === "requested");
  const waiting = rows.filter((row) => row.stage === "awaiting_customer");

  const groups = new Map<string, RotRutQueueRow[]>();
  for (const row of ready) {
    const key = `${row.type}-${row.paymentYear}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const markSent = async (key: string, invoiceIds: string[]) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/invoices/rot-rut/requested", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; updated?: number };
      if (!response.ok) throw new Error(json.error || copy.failed);
      setNotice(copy.marked(json.updated ?? invoiceIds.length));
      router.refresh();
    } catch (markError) {
      setError(markError instanceof Error && markError.message ? markError.message : copy.failed);
    } finally {
      setBusy(null);
    }
  };

  const table = (list: RotRutQueueRow[], last: "paid" | "sent") => (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>{copy.invoice}</th>
            <th>{copy.customer}</th>
            <th>{copy.buyer}</th>
            <th>{last === "paid" ? copy.paid : copy.sent}</th>
            <th>{copy.amount}</th>
            {last === "sent" && <th />}
          </tr>
        </thead>
        <tbody>
          {list.map((row) => (
            <tr key={row.id}>
              <td>
                <Link className="textLink" href={`/invoices/${row.id}#rot-rut`}>
                  {row.invoiceNumber}
                </Link>
              </td>
              <td>{row.customerName}</td>
              <td>{row.buyer}</td>
              <td>{(last === "paid" ? row.paymentDate : row.requestedAt) ?? "-"}</td>
              <td>{money(row.deduction)}</td>
              {last === "sent" && (
                <td>
                  <Link className="textLink" href={`/invoices/${row.id}#rot-rut`}>
                    {copy.register}
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <article className="card" id="rot-rut-requests">
      <h2>{copy.title}</h2>
      <div className="stack">
        <p className="note">{copy.intro}</p>

        {[...groups.entries()].map(([key, list]) => {
          const first = list[0];
          const parts = Math.ceil(list.length / MAX_PER_FILE);
          const fileUrl = (part: number) =>
            `/api/invoices/rot-rut/request-file?type=${first.type}&year=${first.paymentYear}${parts > 1 ? `&part=${part}` : ""}`;
          return (
            <div key={key} className="stack">
              <h3>{copy.group(first.type, first.paymentYear ?? 0, list.length, money(sum(list)))}</h3>
              {first.deadline && first.daysLeft !== null && (
                <p className={first.deadlinePassed || first.deadlineSoon ? "error" : "note"}>
                  {first.deadlinePassed
                    ? copy.deadlinePassed(first.deadline)
                    : first.deadlineSoon
                      ? copy.deadlineSoon(first.deadline, first.daysLeft)
                      : copy.deadline(first.deadline, first.daysLeft)}
                </p>
              )}
              {table(list, "paid")}
              <p className="note">{copy.how}</p>
              {parts > 1 && <p className="note">{copy.parts}</p>}
              <div className="row">
                {Array.from({ length: parts }, (_unused, index) => (
                  <a key={index} className="button" href={fileUrl(index + 1)}>
                    {parts > 1 ? copy.downloadPart(index + 1) : copy.download}
                  </a>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null}
                  onClick={() => void markSent(key, list.map((row) => row.id))}
                >
                  {busy === key ? copy.working : copy.markSent}
                </button>
              </div>
            </div>
          );
        })}

        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}

        {requested.length > 0 && (
          <div className="stack">
            <h3>{copy.sentTitle}</h3>
            {table(requested, "sent")}
          </div>
        )}

        {waiting.length > 0 && <p className="note">{copy.waiting(waiting.length, money(sum(waiting)))}</p>}
      </div>
    </article>
  );
};
