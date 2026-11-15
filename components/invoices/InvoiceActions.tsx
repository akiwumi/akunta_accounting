"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Dialog } from "@/components/invoices/Dialog";
import { round2 } from "@/lib/accounting/math";
import { formatMoney } from "@/lib/data/format";
import { advanceRunDate, type RecurringFrequency } from "@/lib/invoices/recurring";
import { type RotRutStage } from "@/lib/invoices/rotrut";
import { type InvoiceStatusKind } from "@/lib/invoices/status";
import { type Locale } from "@/lib/i18n/locale";

export type InvoiceActionData = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  currency: string;
  grossAmount: number;
  paidAmount: number;
  creditedAmount: number;
  remaining: number;
  statusKind: InvoiceStatusKind;
  overdue: boolean;
  issueDate: string;
  dueDate: string | null;
  reminderCount: number;
  /** Credited money the customer had already paid, not yet booked as paid back. */
  pendingRefund?: number;
  /** True under fakturametoden, where a credit note is booked in full on its date. */
  accrual?: boolean;
  /**
   * ROT/RUT: the part of the invoice Skatteverket pays instead of the
   * customer, what it has paid so far, and where the request stands.
   * `remaining` is always the customer's part.
   */
  rotRut?: {
    type: "ROT" | "RUT";
    skatteverketAmount: number;
    received: number;
    stage: RotRutStage | null;
  } | null;
};

type InvoiceActionsProps = {
  locale: Locale;
  invoice: InvoiceActionData;
  /** "row": the next step and a way in. "detail": everything that can be done. */
  variant: "row" | "detail";
};

type Panel = "send" | "remind" | "pay" | "credit" | "repeat" | "refund" | null;

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const parseAmount = (value: string) => {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? round2(parsed) : NaN;
};

const postJson = async (url: string, body: unknown, method = "POST") => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(json.error || `${response.status}`);
  return json;
};

export const InvoiceActions = ({ locale, invoice, variant }: InvoiceActionsProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const money = (value: number) => formatMoney(value, invoice.currency, numberLocale);

  const copy = sv
    ? {
        send: "Skicka",
        sendAgain: "Skicka igen",
        remind: "Skicka påminnelse",
        pay: "Registrera betalning",
        credit: "Kreditera fakturan",
        repeat: "Upprepa fakturan",
        markSent: "Markera som skickad",
        pdf: "PDF",
        open: "Öppna",
        cancel: "Avbryt",
        working: "Arbetar...",
        failed: "Något gick fel. Försök igen.",
        to: "Till",
        subject: "Ämne",
        message: "Meddelande",
        messageHint: "Lämna tomt för standardtexten. Fakturan bifogas som PDF.",
        sendTitle: `Skicka faktura ${invoice.invoiceNumber}`,
        sendNow: "Skicka fakturan",
        sent: "Fakturan är skickad.",
        remindTitle: `Påminnelse för faktura ${invoice.invoiceNumber}`,
        remindNow: "Skicka påminnelsen",
        reminded: "Påminnelsen är skickad.",
        remindLaw:
          "Ingen avgift eller ränta läggs på. Påminnelseavgift kräver att ni avtalat om den i förväg. Dröjsmålsränta enligt räntelagen kan du kräva separat.",
        remindCount: (n: number) => (n === 0 ? "Ingen påminnelse har skickats ännu." : `${n} påminnelse${n === 1 ? "" : "r"} har skickats tidigare.`),
        loadingText: "Hämtar text...",
        payTitle: `Betalning för faktura ${invoice.invoiceNumber}`,
        amount: "Belopp",
        payDate: "Betalningsdatum",
        fullAmount: "Hela beloppet",
        payNow: "Registrera betalningen",
        paid: "Betalningen är registrerad och bokförd.",
        remainingNow: "Kvar att betala",
        remainingAfter: "Kvar efter den här betalningen",
        payBooks: "Betalningen bokförs på betalningsdatumet.",
        amountInvalid: "Ange ett belopp större än noll.",
        amountTooHigh: "Beloppet är större än det som återstår.",
        creditTitle: `Kreditera faktura ${invoice.invoiceNumber}`,
        creditIntro:
          "En utfärdad faktura ändras aldrig. Du rättar den med en kreditfaktura, för hela eller en del av beloppet.",
        creditAmount: "Belopp att kreditera",
        creditDate: "Datum",
        reason: "Orsak (visas i historiken)",
        creditNow: "Skapa kreditfaktura",
        credited: "Kreditfakturan är skapad.",
        booksAccrual: (date: string) => `Hela kreditfakturan bokförs den ${date} (fakturametoden).`,
        booksNothing: (amount: string) =>
          `Inget bokförs, eftersom beloppet aldrig har betalats. Kunden är skyldig ${amount} mindre.`,
        booksRefund: (refund: string, date: string) =>
          `${refund} bokförs som en återbetalning från företagskontot den ${date}.`,
        booksRefundAndRest: (refund: string, date: string, rest: string) =>
          `${refund} bokförs som en återbetalning från företagskontot den ${date}; resterande ${rest} bokförs inte, eftersom det aldrig har betalats.`,
        booksLater: (refund: string) =>
          `Inget bokförs nu. När du har betalat tillbaka ${refund} registrerar du utbetalningen här på fakturan, och då bokförs den.`,
        refundQuestion: (refund: string) => `Kunden har redan betalat ${refund} av det du krediterar. Är pengarna återbetalda?`,
        refundYes: "Ja, återbetalningen är utbetald",
        refundNo: "Nej, inte ännu",
        refundDate: "Utbetalningsdatum",
        refund: "Registrera återbetalning",
        refundTitle: `Återbetalning för faktura ${invoice.invoiceNumber}`,
        refundIntro: (amount: string) =>
          `${amount} bokförs som en återbetalning från företagskontot på det datum du anger.`,
        refundNow: "Registrera utbetalningen",
        refunded: "Återbetalningen är registrerad och bokförd.",
        creditMax: "Kan krediteras",
        repeatTitle: `Upprepa faktura ${invoice.invoiceNumber}`,
        repeatIntro: "En ny faktura med samma kund och rader skapas automatiskt på varje fakturadatum.",
        frequency: "Hur ofta",
        monthly: "Varje månad",
        quarterly: "Varje kvartal",
        yearly: "Varje år",
        nextDate: "Nästa fakturadatum",
        endDate: "Slutdatum (valfritt)",
        autoSend: "Skicka fakturan till kunden automatiskt",
        autoSendNoEmail: "Kunden saknar e-postadress, så fakturorna skapas som utkast som du skickar själv.",
        repeatNow: "Starta upprepning",
        repeated: "Fakturan upprepas nu. Du hittar den under Återkommande fakturor.",
        markedSent: "Fakturan är markerad som skickad.",
        rotRutPay: (word: string, amount: string) =>
          `Det här är kundens del. ${word}avdraget på ${amount} begär du från Skatteverket när kunden har betalat. Kunden måste ha betalat elektroniskt, inte kontant.`,
        rotRutCreditFull: (word: string) =>
          `En faktura med ${word}avdrag krediteras alltid i sin helhet innan Skatteverket har betalat ut. Krediteringen tar även bort avdraget, så inget begärs från Skatteverket. Skapa sedan en ny faktura med rätt uppgifter.`,
        rotRutCreditRequested:
          "Begäran till Skatteverket är markerad som skickad. Ta tillbaka begäran hos Skatteverket och ångra markeringen på fakturan innan du krediterar.",
        rotRutCreditAfterPayout: (amount: string) =>
          `Skatteverket har betalat ${amount} för den här fakturan. Den delen kan inte krediteras här. Ska den betalas tillbaka kontaktar du Skatteverket.`,
        rotRutRepeat:
          "Upprepade fakturor skapas utan rot- eller rutavdrag. Avdraget behöver kundens uppgifter och timmar för varje faktura, så lägg det på varje faktura för sig.",
        rotRutRequest: "Begär utbetalning från Skatteverket",
        rotRutPayout: "Registrera Skatteverkets utbetalning"
      }
    : {
        send: "Send",
        sendAgain: "Send again",
        remind: "Send reminder",
        pay: "Register payment",
        credit: "Credit this invoice",
        repeat: "Repeat this invoice",
        markSent: "Mark as sent",
        pdf: "PDF",
        open: "Open",
        cancel: "Cancel",
        working: "Working...",
        failed: "Something went wrong. Please try again.",
        to: "To",
        subject: "Subject",
        message: "Message",
        messageHint: "Leave empty for the standard text. The invoice is attached as a PDF.",
        sendTitle: `Send invoice ${invoice.invoiceNumber}`,
        sendNow: "Send the invoice",
        sent: "The invoice has been sent.",
        remindTitle: `Reminder for invoice ${invoice.invoiceNumber}`,
        remindNow: "Send the reminder",
        reminded: "The reminder has been sent.",
        remindLaw:
          "No fee or interest is added. A reminder fee requires that you agreed on it in advance. Late interest under the Swedish Interest Act can be claimed separately.",
        remindCount: (n: number) => (n === 0 ? "No reminder has been sent yet." : `${n} reminder${n === 1 ? " has" : "s have"} been sent before.`),
        loadingText: "Loading text...",
        payTitle: `Payment for invoice ${invoice.invoiceNumber}`,
        amount: "Amount",
        payDate: "Payment date",
        fullAmount: "Full amount",
        payNow: "Register the payment",
        paid: "The payment has been registered and booked.",
        remainingNow: "Left to pay",
        remainingAfter: "Left after this payment",
        payBooks: "The payment is booked on the payment date.",
        amountInvalid: "Enter an amount greater than zero.",
        amountTooHigh: "The amount is more than what remains.",
        creditTitle: `Credit invoice ${invoice.invoiceNumber}`,
        creditIntro: "An issued invoice is never changed. You correct it with a credit note, for all or part of the amount.",
        creditAmount: "Amount to credit",
        creditDate: "Date",
        reason: "Reason (shown in the history)",
        creditNow: "Create credit note",
        credited: "The credit note has been created.",
        booksAccrual: (date: string) => `The whole credit note is booked on ${date} (accrual method).`,
        booksNothing: (amount: string) =>
          `Nothing is booked, since the amount was never paid. The customer owes ${amount} less.`,
        booksRefund: (refund: string, date: string) =>
          `${refund} is booked as a refund from the business account on ${date}.`,
        booksRefundAndRest: (refund: string, date: string, rest: string) =>
          `${refund} is booked as a refund from the business account on ${date}; the remaining ${rest} is not booked, since it was never paid.`,
        booksLater: (refund: string) =>
          `Nothing is booked now. Once you have paid back ${refund}, register the payout here on the invoice and it is booked then.`,
        refundQuestion: (refund: string) => `The customer has already paid ${refund} of what you are crediting. Has the money been paid back?`,
        refundYes: "Yes, the refund has been paid out",
        refundNo: "No, not yet",
        refundDate: "Payout date",
        refund: "Register refund",
        refundTitle: `Refund for invoice ${invoice.invoiceNumber}`,
        refundIntro: (amount: string) => `${amount} is booked as a refund from the business account on the date you enter.`,
        refundNow: "Register the payout",
        refunded: "The refund has been registered and booked.",
        creditMax: "Can be credited",
        repeatTitle: `Repeat invoice ${invoice.invoiceNumber}`,
        repeatIntro: "A new invoice with the same customer and lines is created automatically on each invoice date.",
        frequency: "How often",
        monthly: "Every month",
        quarterly: "Every quarter",
        yearly: "Every year",
        nextDate: "Next invoice date",
        endDate: "End date (optional)",
        autoSend: "Send the invoice to the customer automatically",
        autoSendNoEmail: "The customer has no email address, so the invoices are created as drafts for you to send.",
        repeatNow: "Start repeating",
        repeated: "This invoice now repeats. You will find it under Recurring invoices.",
        markedSent: "The invoice is marked as sent.",
        rotRutPay: (word: string, amount: string) =>
          `This is the customer's part. The ${word} reduction of ${amount} is requested from Skatteverket once the customer has paid. The customer must have paid electronically, not in cash.`,
        rotRutCreditFull: (word: string) =>
          `An invoice with ${word} is always credited in full before Skatteverket has paid out. The credit also removes the reduction, so nothing is requested from Skatteverket. Then create a new invoice with the right details.`,
        rotRutCreditRequested:
          "The request to Skatteverket is marked as sent. Withdraw the request at Skatteverket and undo the mark on the invoice before you credit it.",
        rotRutCreditAfterPayout: (amount: string) =>
          `Skatteverket has paid ${amount} for this invoice. That part cannot be credited here. If it has to be paid back, contact Skatteverket.`,
        rotRutRepeat:
          "Repeated invoices are created without ROT or RUT. The reduction needs the customer's details and the hours for each invoice, so add it on each invoice separately.",
        rotRutRequest: "Request payout from Skatteverket",
        rotRutPayout: "Register Skatteverket's payout"
      };

  const rotRut = invoice.rotRut ?? null;
  const rotRutWord = rotRut?.type === "ROT" ? (sv ? "Rot" : "ROT") : sv ? "Rut" : "RUT";
  const skatteverketReceived = rotRut?.received ?? 0;
  // ROT/RUT before the payout: only the whole invoice can be credited. After it: only the customer's part.
  const rotRutFullCreditOnly = Boolean(rotRut) && rotRut?.stage !== "paid_out";
  const rotRutCreditBlocked = rotRut?.stage === "requested";
  const creditable = Math.max(0, round2(invoice.grossAmount - invoice.creditedAmount - skatteverketReceived));
  // Everything not yet received, from the customer or from Skatteverket: crediting it pays nothing back.
  const unpaidTotal = Math.max(0, round2(invoice.grossAmount - invoice.paidAmount - invoice.creditedAmount - skatteverketReceived));
  const settled = invoice.statusKind === "PAID" || invoice.statusKind === "CREDITED" || invoice.statusKind === "VOID";
  const neverSent = invoice.statusKind === "DRAFT";

  const nextRunDefault = (frequency: RecurringFrequency) => {
    const today = new Date(`${todayIso()}T00:00:00.000Z`);
    let next = advanceRunDate(new Date(`${invoice.issueDate.slice(0, 10)}T00:00:00.000Z`), frequency);
    const anchor = Number(invoice.issueDate.slice(8, 10));
    while (next < today) next = advanceRunDate(next, frequency, anchor);
    return next.toISOString().slice(0, 10);
  };

  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [to, setTo] = useState(invoice.customerEmail ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [refundPaid, setRefundPaid] = useState(false);
  const [refundDate, setRefundDate] = useState(todayIso());
  const [frequency, setFrequency] = useState<RecurringFrequency>("MONTHLY");
  const [nextDate, setNextDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoSend, setAutoSend] = useState(Boolean(invoice.customerEmail));

  const open = (next: Exclude<Panel, null>) => {
    setError(null);
    setNotice(null);
    setDate(todayIso());
    setTo(invoice.customerEmail ?? "");
    setSubject("");
    setMessage("");
    setReason("");
    setRefundPaid(false);
    setRefundDate(todayIso());
    if (next === "pay") setAmount(String(invoice.remaining));
    if (next === "credit") setAmount(String(rotRutFullCreditOnly ? creditable : invoice.remaining > 0 ? invoice.remaining : creditable));
    if (next === "repeat") setNextDate(nextRunDefault(frequency));
    if (next === "remind") {
      setLoadingText(true);
      fetch(`/api/invoices/${invoice.id}/remind`)
        .then((response) => (response.ok ? response.json() : null))
        .then((json: { to?: string; subject?: string; body?: string } | null) => {
          if (!json) return;
          setTo((current) => current || json.to || "");
          setSubject(json.subject ?? "");
          setMessage(json.body ?? "");
        })
        .catch(() => undefined)
        .finally(() => setLoadingText(false));
    }
    setPanel(next);
  };

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPanel(null);
      setNotice(done);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error && actionError.message ? actionError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const payAmount = parseAmount(amount);
  const remainingAfter = Number.isFinite(payAmount) ? Math.max(0, round2(invoice.remaining - payAmount)) : invoice.remaining;

  const submitPayment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(payAmount) || payAmount <= 0) return setError(copy.amountInvalid);
    if (payAmount > invoice.remaining + 0.005) return setError(copy.amountTooHigh);
    const untouched = invoice.paidAmount === 0 && invoice.creditedAmount === 0;
    // On a ROT/RUT invoice "in full" is the customer's whole part.
    const inFull = Math.abs(payAmount - (invoice.grossAmount - (rotRut?.skatteverketAmount ?? 0))) < 0.005;
    void run(
      () =>
        untouched && inFull
          ? postJson(`/api/invoices/${invoice.id}/pay`, { paymentDate: date })
          : postJson(`/api/invoices/${invoice.id}/partial-pay`, { paymentDate: date, amount: payAmount }),
      copy.paid
    );
  };

  // Under kontantmetoden only the part of a credit that pays back money already received is booked.
  const creditAmount = Number.isFinite(payAmount) && payAmount > 0 ? payAmount : 0;
  const creditUnpaidPart = Math.min(creditAmount, unpaidTotal);
  const creditRefundPart = invoice.accrual ? 0 : round2(creditAmount - creditUnpaidPart);
  const creditBooks = invoice.accrual
    ? copy.booksAccrual(date)
    : creditRefundPart <= 0
      ? copy.booksNothing(money(creditAmount))
      : !refundPaid
        ? copy.booksLater(money(creditRefundPart))
        : creditUnpaidPart > 0
          ? copy.booksRefundAndRest(money(creditRefundPart), refundDate, money(creditUnpaidPart))
          : copy.booksRefund(money(creditRefundPart), refundDate);

  const submitCredit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(payAmount) || payAmount <= 0) return setError(copy.amountInvalid);
    void run(
      () =>
        postJson(`/api/invoices/${invoice.id}/credit-note`, {
          issueDate: date,
          amount: payAmount,
          reason: reason.trim() || undefined,
          refundPaidOn: creditRefundPart > 0 && refundPaid ? refundDate : undefined
        }),
      copy.credited
    );
  };

  const emailFields = (
    <label className="stack">
      {copy.to}
      <input type="email" value={to} onChange={(event) => setTo(event.target.value)} required autoFocus />
    </label>
  );

  const footer = (label: string) => (
    <>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? copy.working : label}
        </button>
        <button type="button" className="secondary" onClick={() => setPanel(null)} disabled={busy}>
          {copy.cancel}
        </button>
      </div>
    </>
  );

  const sendButton = (primary: boolean) => (
    <button type="button" className={primary ? undefined : "secondary"} onClick={() => open("send")}>
      {neverSent ? copy.send : copy.sendAgain}
    </button>
  );
  const payButton = (primary: boolean) => (
    <button type="button" className={primary ? undefined : "secondary"} onClick={() => open("pay")}>
      {copy.pay}
    </button>
  );
  const remindButton = (primary: boolean) => (
    <button type="button" className={primary ? undefined : "secondary"} onClick={() => open("remind")}>
      {copy.remind}
    </button>
  );
  const pdfLink = (
    <a className="button secondary" href={`/api/invoices/${invoice.id}/pdf`}>
      {copy.pdf}
    </a>
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        {variant === "row" ? (
          <>
            {neverSent && sendButton(true)}
            {!settled && !neverSent && invoice.overdue && remindButton(true)}
            {!settled && !neverSent && payButton(!invoice.overdue)}
            {(rotRut?.stage === "ready" || rotRut?.stage === "requested") && (
              <Link className="button" href={`/invoices/${invoice.id}#rot-rut`}>
                {rotRut.stage === "ready" ? copy.rotRutRequest : copy.rotRutPayout}
              </Link>
            )}
            {pdfLink}
            <Link className="textLink" href={`/invoices/${invoice.id}`}>
              {copy.open}
            </Link>
          </>
        ) : (
          <>
            {(invoice.pendingRefund ?? 0) > 0 && (
              <button type="button" onClick={() => open("refund")}>
                {copy.refund}
              </button>
            )}
            {neverSent && sendButton(true)}
            {!settled && !neverSent && invoice.overdue && remindButton(true)}
            {!settled && payButton(!neverSent && !invoice.overdue)}
            {!neverSent && sendButton(false)}
            {!settled && !neverSent && !invoice.overdue && remindButton(false)}
            {neverSent && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => postJson(`/api/invoices/${invoice.id}`, { markSent: true }, "PATCH"), copy.markedSent)
                }
              >
                {copy.markSent}
              </button>
            )}
            {pdfLink}
            {creditable > 0 && invoice.statusKind !== "VOID" && (
              <button type="button" className="secondary" onClick={() => open("credit")}>
                {copy.credit}
              </button>
            )}
            <button type="button" className="secondary" onClick={() => open("repeat")}>
              {copy.repeat}
            </button>
          </>
        )}
      </div>
      {notice && <p className="success">{notice}</p>}
      {error && panel === null && <p className="error">{error}</p>}

      {panel === "send" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.sendTitle}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => postJson(`/api/invoices/${invoice.id}/email`, { to: to.trim(), message: message.trim() || undefined }),
              copy.sent
            );
          }}
        >
          {emailFields}
          <label className="stack">
            {copy.message}
            <textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} />
          </label>
          <p className="note">{copy.messageHint}</p>
          {footer(copy.sendNow)}
        </form>
        </Dialog>
      )}

      {panel === "remind" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.remindTitle}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                postJson(`/api/invoices/${invoice.id}/remind`, {
                  to: to.trim(),
                  subject: subject.trim() || undefined,
                  message: message.trim() || undefined
                }),
              copy.reminded
            );
          }}
        >
          <p className="note">
            {copy.remainingNow}: <strong>{money(invoice.remaining)}</strong>. {copy.remindCount(invoice.reminderCount)}
          </p>
          {emailFields}
          <label className="stack">
            {copy.subject}
            <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} />
          </label>
          <label className="stack">
            {copy.message}
            <textarea
              rows={12}
              value={loadingText ? copy.loadingText : message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={loadingText}
              maxLength={5000}
            />
          </label>
          <p className="note">{copy.remindLaw}</p>
          {footer(copy.remindNow)}
        </form>
        </Dialog>
      )}

      {panel === "pay" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.payTitle}>
        <form className="stack" onSubmit={submitPayment}>
          <p className="note">
            {copy.remainingNow}: <strong>{money(invoice.remaining)}</strong>
          </p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="stack">
              {copy.amount} ({invoice.currency})
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required autoFocus />
            </label>
            <label className="stack">
              {copy.payDate}
              <input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} required />
            </label>
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={() => setAmount(String(invoice.remaining))}>
              {copy.fullAmount}
            </button>
            <span className="note">
              {copy.remainingAfter}: <strong>{money(remainingAfter)}</strong>
            </span>
          </div>
          <p className="note">{copy.payBooks}</p>
          {rotRut && rotRut.stage !== "paid_out" && (
            <p className="note">{copy.rotRutPay(rotRutWord, money(rotRut.skatteverketAmount))}</p>
          )}
          {footer(copy.payNow)}
        </form>
        </Dialog>
      )}

      {panel === "credit" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.creditTitle}>
        <form className="stack" onSubmit={submitCredit}>
          <p className="note">{copy.creditIntro}</p>
          {rotRutCreditBlocked && <p className="error">{copy.rotRutCreditRequested}</p>}
          {rotRutFullCreditOnly && !rotRutCreditBlocked && <p className="note">{copy.rotRutCreditFull(sv ? rotRutWord.toLowerCase() : rotRutWord)}</p>}
          {rotRut && skatteverketReceived > 0 && (
            <p className="note">{copy.rotRutCreditAfterPayout(money(skatteverketReceived))}</p>
          )}
          <p className="note">
            {copy.remainingNow}: <strong>{money(invoice.remaining)}</strong>. {copy.creditMax}:{" "}
            <strong>{money(creditable)}</strong>
          </p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="stack">
              {copy.creditAmount} ({invoice.currency})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                readOnly={rotRutFullCreditOnly}
                required
                autoFocus
              />
            </label>
            <label className="stack">
              {copy.creditDate}
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
          </div>
          <label className="stack">
            {copy.reason}
            <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
          </label>
          {creditRefundPart > 0 && (
            <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="note" style={{ padding: 0, marginBottom: 8 }}>
                {copy.refundQuestion(money(creditRefundPart))}
              </legend>
              <label>
                <input type="radio" name="refund-paid" checked={!refundPaid} onChange={() => setRefundPaid(false)} />{" "}
                {copy.refundNo}
              </label>
              <label>
                <input type="radio" name="refund-paid" checked={refundPaid} onChange={() => setRefundPaid(true)} />{" "}
                {copy.refundYes}
              </label>
              {refundPaid && (
                <label className="stack">
                  {copy.refundDate}
                  <input
                    type="date"
                    value={refundDate}
                    max={todayIso()}
                    onChange={(event) => setRefundDate(event.target.value)}
                    required
                  />
                </label>
              )}
            </fieldset>
          )}
          <p>
            <strong>{creditBooks}</strong>
          </p>
          {footer(copy.creditNow)}
        </form>
        </Dialog>
      )}

      {panel === "refund" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.refundTitle}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => postJson(`/api/invoices/${invoice.id}/refund`, { paidOn: date }), copy.refunded);
            }}
          >
            <p>{copy.refundIntro(money(invoice.pendingRefund ?? 0))}</p>
            <label className="stack">
              {copy.refundDate}
              <input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} required autoFocus />
            </label>
            {footer(copy.refundNow)}
          </form>
        </Dialog>
      )}

      {panel === "repeat" && (
        <Dialog open onClose={() => setPanel(null)} title={copy.repeatTitle}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                postJson(`/api/invoices/${invoice.id}/recurring`, {
                  frequency,
                  nextRunDate: nextDate,
                  endDate: endDate || undefined,
                  autoSend: autoSend && Boolean(invoice.customerEmail)
                }),
              copy.repeated
            );
          }}
        >
          <p className="note">{copy.repeatIntro}</p>
          {rotRut && <p className="error">{copy.rotRutRepeat}</p>}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="stack">
              {copy.frequency}
              <select
                value={frequency}
                onChange={(event) => {
                  const value = event.target.value as RecurringFrequency;
                  setFrequency(value);
                  setNextDate(nextRunDefault(value));
                }}
              >
                <option value="MONTHLY">{copy.monthly}</option>
                <option value="QUARTERLY">{copy.quarterly}</option>
                <option value="YEARLY">{copy.yearly}</option>
              </select>
            </label>
            <label className="stack">
              {copy.nextDate}
              <input type="date" value={nextDate} min={todayIso()} onChange={(event) => setNextDate(event.target.value)} required />
            </label>
          </div>
          <label className="stack">
            {copy.endDate}
            <input type="date" value={endDate} min={nextDate || todayIso()} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          {invoice.customerEmail ? (
            <label>
              <input type="checkbox" checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} />{" "}
              {copy.autoSend}
            </label>
          ) : (
            <p className="note">{copy.autoSendNoEmail}</p>
          )}
          {footer(copy.repeatNow)}
        </form>
        </Dialog>
      )}
    </div>
  );
};

type UndoPaymentButtonProps = { locale: Locale; invoiceId: string; paymentId: string };

/** Undoes a registered payment. The ledger entry is cancelled with a reversing entry, never deleted. */
export const UndoPaymentButton = ({ locale, invoiceId, paymentId }: UndoPaymentButtonProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/invoices/${invoiceId}/payments/${paymentId}`, {}, "DELETE");
      setConfirming(false);
      router.refresh();
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : sv ? "Det gick inte att ångra." : "Could not undo.");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button type="button" className="secondary" onClick={() => setConfirming(true)}>
        {sv ? "Ångra" : "Undo"}
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="note">
        {sv
          ? "Betalningen tas bort från fakturan och rättas i bokföringen med en ny verifikation."
          : "The payment is removed from the invoice and corrected in the books with a new entry."}
      </span>
      <div className="row">
        <button type="button" onClick={() => void undo()} disabled={busy}>
          {busy ? (sv ? "Ångrar..." : "Undoing...") : sv ? "Ja, ångra betalningen" : "Yes, undo the payment"}
        </button>
        <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          {sv ? "Avbryt" : "Cancel"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
