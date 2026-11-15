"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Dialog } from "@/components/invoices/Dialog";
import { type QuoteStatus } from "@/lib/invoices/quotes";
import { type Locale } from "@/lib/i18n/locale";

type QuoteActionsProps = {
  locale: Locale;
  quote: {
    id: string;
    quoteNumber: string;
    customerEmail: string | null;
    /** Status as shown: EXPIRED is worked out from the valid until date. */
    status: QuoteStatus;
    invoice: { id: string; invoiceNumber: string } | null;
  };
  /** "row" shows the next step only; "detail" shows everything. */
  variant: "row" | "detail";
};

const request = async (url: string, method: string, body?: unknown) => {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(json.error || `${response.status}`);
  return json;
};

export const QuoteActions = ({ locale, quote, variant }: QuoteActionsProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [to, setTo] = useState(quote.customerEmail ?? "");
  const [message, setMessage] = useState("");

  const copy = sv
    ? {
        send: "Skicka till kunden",
        sendAgain: "Skicka igen",
        accept: "Kunden tackade ja",
        decline: "Kunden tackade nej",
        reopen: "Öppna igen",
        convert: "Gör om till faktura",
        converting: "Skapar faktura...",
        pdf: "PDF",
        open: "Öppna",
        remove: "Ta bort",
        confirmRemove: "Ta bort offerten för gott?",
        yesRemove: "Ja, ta bort",
        cancel: "Avbryt",
        working: "Arbetar...",
        sendTitle: `Skicka offert ${quote.quoteNumber}`,
        to: "Till",
        message: "Meddelande",
        messageHint: "Lämna tomt för standardtexten. Offerten bifogas som PDF.",
        sendNow: "Skicka offerten",
        sent: "Offerten är skickad.",
        accepted: "Offerten är markerad som accepterad. Nästa steg är att göra om den till en faktura.",
        declined: "Offerten är markerad som avböjd.",
        reopened: "Offerten är öppen igen.",
        invoiced: "Fakturerad som",
        failed: "Något gick fel. Försök igen."
      }
    : {
        send: "Send to customer",
        sendAgain: "Send again",
        accept: "Customer accepted",
        decline: "Customer declined",
        reopen: "Reopen",
        convert: "Turn into invoice",
        converting: "Creating invoice...",
        pdf: "PDF",
        open: "Open",
        remove: "Delete",
        confirmRemove: "Delete this quote for good?",
        yesRemove: "Yes, delete",
        cancel: "Cancel",
        working: "Working...",
        sendTitle: `Send quote ${quote.quoteNumber}`,
        to: "To",
        message: "Message",
        messageHint: "Leave empty for the standard text. The quote is attached as a PDF.",
        sendNow: "Send the quote",
        sent: "The quote has been sent.",
        accepted: "The quote is marked as accepted. The next step is to turn it into an invoice.",
        declined: "The quote is marked as declined.",
        reopened: "The quote is open again.",
        invoiced: "Invoiced as",
        failed: "Something went wrong. Please try again."
      };

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error && actionError.message ? actionError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: "ACCEPTED" | "DECLINED" | "SENT" | "DRAFT", done: string) =>
    run(() => request(`/api/quotes/${quote.id}`, "PATCH", { status }), done);

  const convert = () =>
    run(async () => {
      const json = (await request(`/api/quotes/${quote.id}/convert`, "POST")) as { invoice?: { id: string } };
      if (json.invoice) router.push(`/invoices/${json.invoice.id}`);
    });

  const pdfLink = (
    <a className="button secondary" href={`/api/quotes/${quote.id}/pdf`}>
      {copy.pdf}
    </a>
  );

  if (quote.status === "INVOICED") {
    return (
      <div className="row">
        {quote.invoice && (
          <span className="note">
            {copy.invoiced}{" "}
            <Link className="textLink" href={`/invoices/${quote.invoice.id}`}>
              {quote.invoice.invoiceNumber}
            </Link>
          </span>
        )}
        {pdfLink}
        {variant === "row" && (
          <Link className="textLink" href={`/quotes/${quote.id}`}>
            {copy.open}
          </Link>
        )}
      </div>
    );
  }

  const isDraft = quote.status === "DRAFT";
  const isOpen = quote.status === "SENT" || quote.status === "EXPIRED";
  const convertButton = (primary: boolean) => (
    <button type="button" className={primary ? undefined : "secondary"} disabled={busy} onClick={() => void convert()}>
      {busy ? copy.working : copy.convert}
    </button>
  );
  const sendButton = (primary: boolean) => (
    <button type="button" className={primary ? undefined : "secondary"} onClick={() => setSendOpen(true)}>
      {isDraft ? copy.send : copy.sendAgain}
    </button>
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        {variant === "row" ? (
          <>
            {isDraft && sendButton(true)}
            {isOpen && (
              <button type="button" disabled={busy} onClick={() => void setStatus("ACCEPTED", copy.accepted)}>
                {copy.accept}
              </button>
            )}
            {quote.status === "ACCEPTED" && convertButton(true)}
            {pdfLink}
            <Link className="textLink" href={`/quotes/${quote.id}`}>
              {copy.open}
            </Link>
          </>
        ) : (
          <>
            {isDraft && sendButton(true)}
            {quote.status === "ACCEPTED" && convertButton(true)}
            {isOpen && (
              <button type="button" disabled={busy} onClick={() => void setStatus("ACCEPTED", copy.accepted)}>
                {copy.accept}
              </button>
            )}
            {(isDraft || isOpen) && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void setStatus("DECLINED", copy.declined)}
              >
                {copy.decline}
              </button>
            )}
            {quote.status !== "ACCEPTED" && quote.status !== "DECLINED" && convertButton(false)}
            {!isDraft && quote.status !== "DECLINED" && sendButton(false)}
            {(quote.status === "DECLINED" || quote.status === "ACCEPTED") && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void setStatus("SENT", copy.reopened)}
              >
                {copy.reopen}
              </button>
            )}
            {pdfLink}
            {!confirmDelete ? (
              <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
                {copy.remove}
              </button>
            ) : (
              <>
                <span className="note">{copy.confirmRemove}</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(`/api/quotes/${quote.id}`, "DELETE");
                      router.push("/quotes");
                    })
                  }
                >
                  {copy.yesRemove}
                </button>
                <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                  {copy.cancel}
                </button>
              </>
            )}
          </>
        )}
      </div>
      {notice && <p className="success">{notice}</p>}
      {error && !sendOpen && <p className="error">{error}</p>}

      {sendOpen && (
        <Dialog open onClose={() => setSendOpen(false)} title={copy.sendTitle}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request(`/api/quotes/${quote.id}/email`, "POST", {
                to: to.trim(),
                message: message.trim() || undefined
              });
              setSendOpen(false);
            }, copy.sent);
          }}
        >
          <label className="stack">
            {copy.to}
            <input type="email" value={to} onChange={(event) => setTo(event.target.value)} required autoFocus />
          </label>
          <label className="stack">
            {copy.message}
            <textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} />
          </label>
          <p className="note">{copy.messageHint}</p>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? copy.working : copy.sendNow}
            </button>
            <button type="button" className="secondary" onClick={() => setSendOpen(false)} disabled={busy}>
              {copy.cancel}
            </button>
          </div>
        </form>
        </Dialog>
      )}
    </div>
  );
};
