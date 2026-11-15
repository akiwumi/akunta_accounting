"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Dialog } from "@/components/invoices/Dialog";
import { formatMoney } from "@/lib/data/format";
import { type RotRutStage } from "@/lib/invoices/rotrut";
import { type Locale } from "@/lib/i18n/locale";

export type RotRutPanelData = {
  id: string;
  invoiceNumber: string;
  type: "ROT" | "RUT";
  stage: RotRutStage;
  /** The preliminary reduction: what is requested from Skatteverket. */
  deduction: number;
  /** The customer's whole part of the invoice. */
  customerTotal: number;
  /** What the customer still owes. */
  customerRemaining: number;
  /** YYYY-MM-DD */
  paymentDate: string | null;
  deadline: string | null;
  daysLeft: number | null;
  requestedAt: string | null;
  paidOutAt: string | null;
  payoutAmount: number | null;
  shortfall: number;
  payoutVerificationNumber: number | null;
  /** Suggested date for the customer to pay a difference by. */
  suggestedDueDate: string;
  /** The values of the request, for checking or typing by hand. Empty until the customer has paid. */
  requestValues: { label: string; value: string }[];
};

const SKATTEVERKET_URL = "https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut.4.2ef18e6a125660db8b080002674.html";
const WARNING_DAYS = 45;

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const parseAmount = (value: string) => {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
};

const send = async (url: string, body: unknown, method = "POST") => {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(json.error || `${response.status}`);
  return json;
};

/** The request to Skatteverket for one invoice: what to do now, and the buttons that do it. */
export const RotRutPanel = ({ locale, invoice }: { locale: Locale; invoice: RotRutPanelData }) => {
  const router = useRouter();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");
  const word = invoice.type === "ROT" ? (sv ? "rotavdraget" : "the ROT reduction") : sv ? "rutavdraget" : "the RUT reduction";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(String(invoice.deduction));
  const [newDueDate, setNewDueDate] = useState(invoice.suggestedDueDate);

  const copy = sv
    ? {
        waitCustomer: (left: string, requested: string) =>
          `Steg 1 av 3: vänta på kundens betalning. Kunden har ${left} kvar att betala. När hela kundens del är betald och registrerad här kan du begära ${requested} från Skatteverket. Kunden måste betala elektroniskt (inte kontant).`,
        readyTitle: (requested: string) => `Steg 2 av 3: begär ${requested} från Skatteverket`,
        deadline: (day: string, days: number) => `Begäran ska ha kommit in till Skatteverket senast ${day} (${days} dagar kvar).`,
        deadlineSoon: (day: string, days: number) =>
          `Snart sista dagen: begäran ska ha kommit in till Skatteverket senast ${day}. ${days} dagar kvar.`,
        deadlinePassed: (day: string) =>
          `Sista dagen var ${day}. Skatteverket betalar inte ut för en begäran som kommer in för sent. Kontakta Skatteverket om du är osäker.`,
        step1: "Ladda ner filen med begäran.",
        step2: 'Logga in i Skatteverkets e-tjänst "Rot och rut - företag" med BankID och välj att lämna begäran med en fil.',
        step3: "Välj filen, kontrollera uppgifterna och skriv under.",
        step4: 'Kom tillbaka hit och klicka på "Jag har skickat begäran".',
        download: "Ladda ner filen",
        downloadAgain: "Ladda ner filen igen",
        eService: "Skatteverkets sida om rot och rut",
        markSent: "Jag har skickat begäran",
        marked: "Begäran är markerad som skickad.",
        values: "Visa värdena i begäran (om du hellre fyller i e-tjänsten för hand)",
        valuesNote: "Belopp i hela kronor. Material och övriga kostnader anges som fakturerat, inklusive moms.",
        waiting: (requested: string, day: string) =>
          `Steg 3 av 3: du skickade begäran den ${day}. När Skatteverket har betalat ut ${requested} till ditt konto registrerar du det här, så bokförs det.`,
        payout: "Skatteverket har betalat",
        undoSent: "Ångra: begäran är inte skickad",
        unmarked: "Markeringen är borttagen.",
        payoutTitle: `Utbetalning från Skatteverket, faktura ${invoice.invoiceNumber}`,
        payoutDate: "Datum då pengarna kom in",
        payoutAmount: "Belopp du fick (kr)",
        payoutBooks: (value: string) =>
          `${value} bokförs som försäljning med moms på det datumet. Momsen på Skatteverkets del redovisas alltså i den perioden.`,
        payoutNothing: "Inget bokförs, eftersom inga pengar kom in.",
        lower: (diff: string) =>
          `Skatteverket betalade ${diff} mindre än du begärde, oftast för att kunden redan har använt sitt utrymme för året. Kunden är skyldig dig ${diff}. Fakturan öppnas igen för det beloppet, och fakturans PDF visar mellanskillnaden. Skicka fakturan till kunden igen.`,
        newDue: "Kunden ska betala mellanskillnaden senast",
        tooHigh: "Beloppet kan inte vara större än det du begärde.",
        payoutNow: "Registrera utbetalningen",
        payoutDone: "Utbetalningen är registrerad och bokförd.",
        payoutDoneLower: (diff: string) =>
          `Utbetalningen är registrerad. Kunden är nu skyldig ${diff}: fakturan är öppen igen för det beloppet. Skicka den till kunden igen.`,
        done: (value: string, day: string) => `Klart: Skatteverket betalade ${value} den ${day}.`,
        doneNothing: (day: string) => `Skatteverket betalade inget (registrerat ${day}).`,
        verification: (n: number) => `Verifikation ${n}.`,
        shortfall: (diff: string, requested: string, left: string) =>
          `Du begärde ${requested}. Mellanskillnaden på ${diff} ska kunden betala, och fakturan är öppen igen för den. Kvar att betala för kunden: ${left}.`,
        undoPayout: "Ångra utbetalningen",
        undoPayoutConfirm: "Utbetalningen tas bort från fakturan och rättas i bokföringen med en ny verifikation.",
        undoPayoutYes: "Ja, ångra utbetalningen",
        undone: "Utbetalningen är ångrad.",
        cancelled: `Fakturan är krediterad eller makulerad, så ${word} begärs inte från Skatteverket.`,
        cancel: "Avbryt",
        working: "Arbetar...",
        failed: "Något gick fel. Försök igen."
      }
    : {
        waitCustomer: (left: string, requested: string) =>
          `Step 1 of 3: wait for the customer's payment. The customer has ${left} left to pay. Once the customer's whole part is paid and registered here, you can request ${requested} from Skatteverket. The customer must pay electronically (not in cash).`,
        readyTitle: (requested: string) => `Step 2 of 3: request ${requested} from Skatteverket`,
        deadline: (day: string, days: number) => `The request must reach Skatteverket by ${day} (${days} days left).`,
        deadlineSoon: (day: string, days: number) =>
          `The deadline is close: the request must reach Skatteverket by ${day}. ${days} days left.`,
        deadlinePassed: (day: string) =>
          `The deadline was ${day}. Skatteverket does not pay out for a request that arrives late. Contact Skatteverket if you are unsure.`,
        step1: "Download the request file.",
        step2: 'Log in to Skatteverket\'s e-service "Rot och rut - företag" with BankID and choose to submit the request with a file.',
        step3: "Pick the file, check the details and sign.",
        step4: 'Come back here and click "I have sent the request".',
        download: "Download the file",
        downloadAgain: "Download the file again",
        eService: "Skatteverket's page on ROT and RUT",
        markSent: "I have sent the request",
        marked: "The request is marked as sent.",
        values: "Show the values of the request (if you would rather fill in the e-service by hand)",
        valuesNote: "Amounts in whole kronor. Material and other costs are given as invoiced, including VAT.",
        waiting: (requested: string, day: string) =>
          `Step 3 of 3: you sent the request on ${day}. When Skatteverket has paid ${requested} into your account, register it here and it is booked.`,
        payout: "Skatteverket has paid",
        undoSent: "Undo: the request has not been sent",
        unmarked: "The mark has been removed.",
        payoutTitle: `Payout from Skatteverket, invoice ${invoice.invoiceNumber}`,
        payoutDate: "Date the money arrived",
        payoutAmount: "Amount you received (kr)",
        payoutBooks: (value: string) =>
          `${value} is booked as sales with VAT on that date. The VAT on Skatteverket's part is reported in that period.`,
        payoutNothing: "Nothing is booked, since no money arrived.",
        lower: (diff: string) =>
          `Skatteverket paid ${diff} less than you requested, usually because the customer has already used their allowance for the year. The customer owes you ${diff}. The invoice is opened again for that amount, and the invoice PDF shows the difference. Send the invoice to the customer again.`,
        newDue: "The customer should pay the difference by",
        tooHigh: "The amount cannot be more than what you requested.",
        payoutNow: "Register the payout",
        payoutDone: "The payout has been registered and booked.",
        payoutDoneLower: (diff: string) =>
          `The payout has been registered. The customer now owes ${diff}: the invoice is open again for that amount. Send it to the customer again.`,
        done: (value: string, day: string) => `Done: Skatteverket paid ${value} on ${day}.`,
        doneNothing: (day: string) => `Skatteverket paid nothing (registered ${day}).`,
        verification: (n: number) => `Verification ${n}.`,
        shortfall: (diff: string, requested: string, left: string) =>
          `You requested ${requested}. The difference of ${diff} is the customer's to pay, and the invoice is open again for it. Left for the customer to pay: ${left}.`,
        undoPayout: "Undo the payout",
        undoPayoutConfirm: "The payout is removed from the invoice and corrected in the books with a new entry.",
        undoPayoutYes: "Yes, undo the payout",
        undone: "The payout has been undone.",
        cancelled: `This invoice has been credited or voided, so ${word} is not requested from Skatteverket.`,
        cancel: "Cancel",
        working: "Working...",
        failed: "Something went wrong. Please try again."
      };

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setPayoutOpen(false);
      setConfirmUndo(false);
      setNotice(done);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error && actionError.message ? actionError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const fileUrl = `/api/invoices/${invoice.id}/rot-rut/request-file`;
  const received = parseAmount(amount);
  const difference = Number.isFinite(received) ? Math.round((invoice.deduction - received) * 100) / 100 : 0;

  const deadlineLine =
    invoice.deadline && invoice.daysLeft !== null ? (
      invoice.daysLeft < 0 ? (
        <p className="error">{copy.deadlinePassed(invoice.deadline)}</p>
      ) : invoice.daysLeft <= WARNING_DAYS ? (
        <p className="error">{copy.deadlineSoon(invoice.deadline, invoice.daysLeft)}</p>
      ) : (
        <p className="note">{copy.deadline(invoice.deadline, invoice.daysLeft)}</p>
      )
    ) : null;

  const values = invoice.requestValues.length > 0 && (
    <details>
      <summary className="note">{copy.values}</summary>
      <div className="tableWrap" style={{ marginTop: 8 }}>
        <table>
          <tbody>
            {invoice.requestValues.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <strong>{row.value}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{copy.valuesNote}</p>
    </details>
  );

  return (
    <div className="stack">
      {invoice.stage === "cancelled" && <p className="note">{copy.cancelled}</p>}

      {invoice.stage === "awaiting_customer" && (
        <p>{copy.waitCustomer(money(invoice.customerRemaining), money(invoice.deduction))}</p>
      )}

      {invoice.stage === "ready" && (
        <>
          <p>
            <strong>{copy.readyTitle(money(invoice.deduction))}</strong>
          </p>
          {deadlineLine}
          <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 4 }}>
            <li>{copy.step1}</li>
            <li>{copy.step2}</li>
            <li>{copy.step3}</li>
            <li>{copy.step4}</li>
          </ol>
          <div className="row">
            <a className="button" href={fileUrl}>
              {copy.download}
            </a>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => send(`/api/invoices/${invoice.id}/rot-rut/requested`, { sent: true }), copy.marked)}
            >
              {busy ? copy.working : copy.markSent}
            </button>
            <a className="textLink" href={SKATTEVERKET_URL} target="_blank" rel="noreferrer">
              {copy.eService}
            </a>
          </div>
          {values}
        </>
      )}

      {invoice.stage === "requested" && (
        <>
          <p>{copy.waiting(money(invoice.deduction), invoice.requestedAt ?? "-")}</p>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDate(todayIso());
                setAmount(String(invoice.deduction));
                setPayoutOpen(true);
              }}
            >
              {copy.payout}
            </button>
            <a className="button secondary" href={fileUrl}>
              {copy.downloadAgain}
            </a>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => send(`/api/invoices/${invoice.id}/rot-rut/requested`, { sent: false }), copy.unmarked)}
            >
              {copy.undoSent}
            </button>
          </div>
          {values}
        </>
      )}

      {invoice.stage === "paid_out" && (
        <>
          <p>
            {(invoice.payoutAmount ?? 0) > 0
              ? copy.done(money(invoice.payoutAmount ?? 0), invoice.paidOutAt ?? "-")
              : copy.doneNothing(invoice.paidOutAt ?? "-")}{" "}
            {invoice.payoutVerificationNumber !== null && copy.verification(invoice.payoutVerificationNumber)}
          </p>
          {invoice.shortfall > 0 && (
            <p className="error">
              {copy.shortfall(money(invoice.shortfall), money(invoice.deduction), money(invoice.customerRemaining))}
            </p>
          )}
          {confirmUndo ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="note">{copy.undoPayoutConfirm}</span>
              <div className="row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => send(`/api/invoices/${invoice.id}/rot-rut/payout`, {}, "DELETE"), copy.undone)}
                >
                  {busy ? copy.working : copy.undoPayoutYes}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmUndo(false)}>
                  {copy.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              <button type="button" className="secondary" onClick={() => setConfirmUndo(true)}>
                {copy.undoPayout}
              </button>
            </div>
          )}
        </>
      )}

      {notice && <p className="success">{notice}</p>}
      {error && !payoutOpen && <p className="error">{error}</p>}

      {payoutOpen && (
        <Dialog open onClose={() => setPayoutOpen(false)} title={copy.payoutTitle}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!Number.isFinite(received) || received < 0 || received > invoice.deduction + 0.004) return setError(copy.tooHigh);
              void run(
                () =>
                  send(`/api/invoices/${invoice.id}/rot-rut/payout`, {
                    paidOn: date,
                    amount: received,
                    newDueDate: difference > 0 ? newDueDate : undefined
                  }),
                difference > 0 ? copy.payoutDoneLower(money(difference)) : copy.payoutDone
              );
            }}
          >
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="stack">
                {copy.payoutAmount}
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required autoFocus />
              </label>
              <label className="stack">
                {copy.payoutDate}
                <input
                  type="date"
                  value={date}
                  min={invoice.paymentDate ?? undefined}
                  max={todayIso()}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </label>
            </div>
            <p className="note">{Number.isFinite(received) && received > 0 ? copy.payoutBooks(money(received)) : copy.payoutNothing}</p>
            {difference > 0 && (
              <>
                <p>
                  <strong>{copy.lower(money(difference))}</strong>
                </p>
                <label className="stack">
                  {copy.newDue}
                  <input type="date" value={newDueDate} min={todayIso()} onChange={(event) => setNewDueDate(event.target.value)} required />
                </label>
              </>
            )}
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="submit" disabled={busy}>
                {busy ? copy.working : copy.payoutNow}
              </button>
              <button type="button" className="secondary" onClick={() => setPayoutOpen(false)} disabled={busy}>
                {copy.cancel}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
};
