export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceActions, UndoPaymentButton } from "@/components/invoices/InvoiceActions";
import { RotRutPanel } from "@/components/invoices/RotRutPanel";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { addDays, isoDate, stockholmToday } from "@/lib/invoices/dates";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { paymentAccountLines } from "@/lib/invoices/payment-accounts";
import {
  formatPersonnummer,
  maskPersonnummer,
  rotRutCaseSummary,
  rotRutDeadlineState,
  rotRutPropertyText,
  rotRutWorkTypeLabel
} from "@/lib/invoices/rotrut";
import { computeInvoiceStatus, invoiceStatusLabel, invoiceStatusTone } from "@/lib/invoices/status";

type InvoicePageProps = { params: Promise<{ id: string }> };

export default async function InvoicePage(props: InvoicePageProps) {
  const { id } = await props.params;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();

  const invoice = await loadInvoiceForOutput({ businessId: business.id, invoiceId: id });
  if (!invoice) notFound();

  const [quote, template] = await Promise.all([
    prisma.quote.findFirst({ where: { invoiceId: invoice.id, businessId: business.id }, select: { id: true, quoteNumber: true } }),
    invoice.recurringInvoiceId
      ? prisma.recurringInvoice.findFirst({
          where: { id: invoice.recurringInvoiceId, businessId: business.id },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);

  const today = stockholmToday();
  const status = computeInvoiceStatus({
    status: invoice.status,
    grossAmount: invoice.grossAmount,
    paidAmount: invoice.paidAmount,
    creditedAmount: invoice.creditedAmount,
    skatteverketAmount: invoice.rotRut?.skatteverketAmount ?? 0,
    dueDate: invoice.dueDate,
    sentAt: invoice.sentAt,
    today
  });
  const rotRut = invoice.rotRut;
  const rotRutDeadline = rotRut?.deadline ? rotRutDeadlineState(rotRut.deadline, today) : null;
  const money = (value: number) => formatMoney(value, invoice.currency, numberLocale);
  const accountLines = paymentAccountLines(invoice.paymentAccounts);

  const copy = sv
    ? {
        back: "Alla fakturor",
        title: `Faktura ${invoice.invoiceNumber}`,
        to: "Till",
        total: "Fakturabelopp",
        paid: "Betalt",
        credited: "Krediterat",
        remaining: "Kvar att betala",
        issueDate: "Fakturadatum",
        dueDate: "Förfallodatum",
        ocr: "OCR-nummer",
        sent: "Skickad",
        notSent: "Inte skickad ännu",
        reminders: "Påminnelser",
        remindersNone: "Inga skickade",
        remindersSent: (n: number, last: string) => `${n} skickade, senast ${last}`,
        fromQuote: "Skapad från offert",
        recurring: "Skapad av en återkommande faktura",
        seeRecurring: "Visa återkommande fakturor",
        lines: "Rader",
        description: "Beskrivning",
        quantity: "Antal",
        unitPrice: "Pris",
        vat: "Moms",
        amount: "Belopp",
        subtotal: "Summa exkl. moms",
        history: "Betalningar och krediteringar",
        historyEmpty: "Inget är betalt eller krediterat ännu.",
        date: "Datum",
        what: "Händelse",
        payment: "Betalning",
        creditNote: "Kreditfaktura",
        cancelled: "ångrad",
        refundPending: (amount: string) => `Återbetalning på ${amount} är inte utbetald ännu`,
        notBooked: "Bokförs inte, eftersom beloppet aldrig betalades",
        refundDue: (amount: string) =>
          `Du har krediterat ${amount} som kunden redan betalat. Registrera återbetalningen när pengarna har lämnat kontot, så bokförs den då.`,
        verification: "Verifikation",
        howToPay: "Så betalar kunden",
        noAccounts:
          "Inga betalningsuppgifter är inlagda, så fakturan säger inte hur kunden ska betala.",
        addAccounts: "Lägg till bankgiro, plusgiro, Swish eller IBAN",
        locked:
          "En utfärdad faktura ändras inte. Blev något fel krediterar du fakturan och skapar en ny.",
        notes: "Meddelande på fakturan",
        customerPart: "Kundens del",
        ofWhichSkatteverket: (amount: string) => `Varav från Skatteverket: ${amount}`,
        rotRutTitle: (type: string) => (type === "ROT" ? "Rotavdrag" : "Rutavdrag"),
        rotRutNumbers: "Så fördelas fakturan",
        labour: "Arbete inkl. moms",
        material: "Material inkl. moms",
        other: "Övriga kostnader inkl. moms",
        reduction: (percent: number) => `Preliminär skattereduktion (${percent} % av arbetet)`,
        notApproved: "Ej utbetalt av Skatteverket, betalas av kunden",
        customerPays: "Kunden betalar",
        buyer: "Köpare",
        showBuyer: "Visa hela personnumret",
        home: "Bostad",
        helpers: (sub: boolean, staff: boolean) =>
          `Underentreprenör: ${sub ? "ja" : "nej"}. Bemanningsföretag: ${staff ? "ja" : "nej"}.`,
        labourLine: (work: string, hours: number | null) => `Arbete: ${work}${hours ? `, ${hours} tim` : ""}`,
        materialLine: (work: string) => `Material (${work})`,
        otherLine: "Övrig kostnad",
        counts: "Räknas som",
        payout: "Utbetalning från Skatteverket",
        payoutNothing: "Skatteverket betalade inget"
      }
    : {
        back: "All invoices",
        title: `Invoice ${invoice.invoiceNumber}`,
        to: "To",
        total: "Invoice amount",
        paid: "Paid",
        credited: "Credited",
        remaining: "Left to pay",
        issueDate: "Invoice date",
        dueDate: "Due date",
        ocr: "OCR reference",
        sent: "Sent",
        notSent: "Not sent yet",
        reminders: "Reminders",
        remindersNone: "None sent",
        remindersSent: (n: number, last: string) => `${n} sent, latest ${last}`,
        fromQuote: "Created from quote",
        recurring: "Created by a recurring invoice",
        seeRecurring: "Show recurring invoices",
        lines: "Lines",
        description: "Description",
        quantity: "Qty",
        unitPrice: "Price",
        vat: "VAT",
        amount: "Amount",
        subtotal: "Total excl. VAT",
        history: "Payments and credits",
        historyEmpty: "Nothing has been paid or credited yet.",
        date: "Date",
        what: "Event",
        payment: "Payment",
        creditNote: "Credit note",
        cancelled: "undone",
        refundPending: (amount: string) => `Refund of ${amount} has not been paid out yet`,
        notBooked: "Not booked, since the amount was never paid",
        refundDue: (amount: string) =>
          `You have credited ${amount} that the customer already paid. Register the refund once the money has left your account, and it is booked then.`,
        verification: "Verification",
        howToPay: "How the customer pays",
        noAccounts: "No payment details are set, so the invoice does not say how the customer should pay.",
        addAccounts: "Add bankgiro, plusgiro, Swish or IBAN",
        locked: "An issued invoice is not changed. If something is wrong, credit the invoice and create a new one.",
        notes: "Message on the invoice",
        customerPart: "The customer's part",
        ofWhichSkatteverket: (amount: string) => `Of which from Skatteverket: ${amount}`,
        rotRutTitle: (type: string) => (type === "ROT" ? "ROT reduction" : "RUT reduction"),
        rotRutNumbers: "How the invoice is split",
        labour: "Labour incl. VAT",
        material: "Material incl. VAT",
        other: "Other costs incl. VAT",
        reduction: (percent: number) => `Preliminary tax reduction (${percent} % of the labour)`,
        notApproved: "Not paid by Skatteverket, paid by the customer",
        customerPays: "The customer pays",
        buyer: "Buyer",
        showBuyer: "Show the whole personnummer",
        home: "Home",
        helpers: (sub: boolean, staff: boolean) =>
          `Subcontractor: ${sub ? "yes" : "no"}. Staffing agency: ${staff ? "yes" : "no"}.`,
        labourLine: (work: string, hours: number | null) => `Labour: ${work}${hours ? `, ${hours} h` : ""}`,
        materialLine: (work: string) => `Material (${work})`,
        otherLine: "Other cost",
        counts: "Counts as",
        payout: "Payout from Skatteverket",
        payoutNothing: "Skatteverket paid nothing"
      };

  const history = [
    ...invoice.payments.map((payment) => ({
      key: `p-${payment.id}`,
      date: payment.paymentDate,
      label: copy.payment,
      detail: payment.reference ?? "",
      amount: payment.amount,
      cancelled: payment.cancelled,
      transactionId: payment.transactionId,
      verificationNumber: payment.verificationNumber,
      paymentId: payment.id as string | null
    })),
    ...invoice.creditNotes.map((note) => ({
      key: `c-${note.id}`,
      date: note.issueDate,
      label: `${copy.creditNote} ${note.creditNoteNumber}`,
      detail: [
        note.reason ?? "",
        note.pendingRefund > 0 ? copy.refundPending(money(note.pendingRefund)) : "",
        !invoice.accrual && note.refund === 0 && !note.transactionId ? copy.notBooked : ""
      ]
        .filter(Boolean)
        .join(". "),
      amount: note.amount,
      cancelled: false,
      transactionId: note.transactionId,
      verificationNumber: note.verificationNumber,
      paymentId: null as string | null
    })),
    ...(rotRut?.paidOutAt
      ? [
          {
            key: "rot-rut-payout",
            date: rotRut.paidOutAt,
            label: (rotRut.payoutAmount ?? 0) > 0 ? copy.payout : copy.payoutNothing,
            detail: "",
            amount: rotRut.payoutAmount ?? 0,
            cancelled: false,
            transactionId: rotRut.payoutTransactionId,
            verificationNumber: rotRut.payoutVerificationNumber,
            paymentId: null as string | null
          }
        ]
      : [])
  ].sort((a, b) => a.date.valueOf() - b.date.valueOf());

  return (
    <section className="page">
      <p className="note">
        <Link className="textLink" href="/invoices#invoice-list">
          {copy.back}
        </Link>
      </p>
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">
        {copy.to}{" "}
        {invoice.customerId ? (
          <Link className="textLink" href={`/customers/${invoice.customerId}`}>
            {invoice.customerName}
          </Link>
        ) : (
          invoice.customerName
        )}{" "}
        <span className={`badge ${invoiceStatusTone(status)}`.trim()}>{invoiceStatusLabel(status, locale)}</span>
      </p>

      <div className="grid">
        <article className="card">
          <p className="label">{copy.remaining}</p>
          <p className="kpi">{money(status.remaining)}</p>
          <p className="note">
            {copy.dueDate}: {invoice.dueDate ? isoDate(invoice.dueDate) : "-"}
          </p>
        </article>
        <article className="card">
          <p className="label">{copy.total}</p>
          <p className="kpi">{money(invoice.grossAmount)}</p>
          <p className="note">
            {copy.issueDate}: {isoDate(invoice.issueDate)}
          </p>
          {rotRut && (
            <p className="note">
              {copy.customerPart}: {money(rotRut.customerTotal)}. {copy.ofWhichSkatteverket(money(rotRut.skatteverketAmount))}
            </p>
          )}
        </article>
        <article className="card">
          <p className="label">{copy.paid}</p>
          <p className="kpi">{money(invoice.paidAmount)}</p>
          {invoice.creditedAmount > 0 && (
            <p className="note">
              {copy.credited}: {money(invoice.creditedAmount)}
            </p>
          )}
        </article>
      </div>

      <article className="card">
        {invoice.pendingRefund > 0 && (
          <p className="note" style={{ marginBottom: 12 }}>
            {copy.refundDue(money(invoice.pendingRefund))}
          </p>
        )}
        <InvoiceActions
          locale={locale}
          variant="detail"
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customerName,
            customerEmail: invoice.emailTo ?? invoice.customerEmail,
            currency: invoice.currency,
            grossAmount: invoice.grossAmount,
            paidAmount: invoice.paidAmount,
            creditedAmount: invoice.creditedAmount,
            remaining: status.remaining,
            statusKind: status.kind,
            overdue: status.overdue,
            issueDate: invoice.issueDate.toISOString(),
            dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
            reminderCount: invoice.reminderCount,
            pendingRefund: invoice.pendingRefund,
            accrual: invoice.accrual,
            rotRut: rotRut
              ? {
                  type: rotRut.type,
                  skatteverketAmount: rotRut.skatteverketAmount,
                  received: rotRut.payoutAmount ?? 0,
                  stage: rotRut.stage
                }
              : null
          }}
        />
      </article>

      {rotRut && rotRut.stage && (
        <article className="card" id="rot-rut">
          <h2>{copy.rotRutTitle(rotRut.type)}</h2>
          <div className="grid">
            <div className="stack">
              <RotRutPanel
                locale={locale}
                invoice={{
                  id: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  type: rotRut.type,
                  stage: rotRut.stage,
                  deduction: rotRut.deduction,
                  customerTotal: rotRut.customerTotal,
                  customerRemaining: status.remaining,
                  paymentDate: rotRut.paymentDate ? isoDate(rotRut.paymentDate) : null,
                  deadline: rotRut.deadline ? isoDate(rotRut.deadline) : null,
                  daysLeft: rotRutDeadline ? rotRutDeadline.daysLeft : null,
                  requestedAt: rotRut.requestedAt ? isoDate(rotRut.requestedAt) : null,
                  paidOutAt: rotRut.paidOutAt ? isoDate(rotRut.paidOutAt) : null,
                  payoutAmount: rotRut.payoutAmount,
                  shortfall: rotRut.shortfall,
                  payoutVerificationNumber: rotRut.payoutVerificationNumber,
                  suggestedDueDate: isoDate(addDays(today, 30)),
                  // The values hold the personnummer, so they are only sent to the page when the request can be made.
                  requestValues:
                    rotRut.requestCase && (rotRut.stage === "ready" || rotRut.stage === "requested")
                      ? rotRutCaseSummary(rotRut.requestCase, rotRut.type, locale)
                      : []
                }}
              />
            </div>
            <div className="stack">
              <p className="label">{copy.rotRutNumbers}</p>
              <div className="invoiceTotals">
                <p>
                  {copy.labour}: <strong>{money(rotRut.labourAmount)}</strong>
                </p>
                <p>
                  {copy.material}: <strong>{money(rotRut.materialAmount)}</strong>
                </p>
                <p>
                  {copy.other}: <strong>{money(rotRut.otherAmount)}</strong>
                </p>
                <p>
                  {copy.reduction(Math.round(rotRut.rate * 100))}: <strong>{money(-rotRut.deduction)}</strong>
                </p>
                {rotRut.shortfall > 0 && (
                  <p>
                    {copy.notApproved}: <strong>{money(rotRut.shortfall)}</strong>
                  </p>
                )}
                <p>
                  {copy.customerPays}: <strong>{money(rotRut.customerTotal)}</strong>
                </p>
              </div>
              <p className="note">
                {copy.buyer}: {invoice.customerName}, {maskPersonnummer(rotRut.details.personnummer)}
              </p>
              <details>
                <summary className="note">{copy.showBuyer}</summary>
                <p className="note">{formatPersonnummer(rotRut.details.personnummer)}</p>
              </details>
              {rotRut.type === "ROT" && (
                <p className="note">
                  {copy.home}: {rotRutPropertyText(rotRut.details, locale)}
                </p>
              )}
              <p className="note">{copy.helpers(rotRut.details.subcontractor, rotRut.details.staffingAgency)}</p>
            </div>
          </div>
        </article>
      )}

      <div className="grid">
        <article className="card">
          <h2>{copy.howToPay}</h2>
          <div className="stack">
            {accountLines.map((line) => (
              <p key={line.label} className="note">
                {line.label}: <strong>{line.value}</strong>
              </p>
            ))}
            {invoice.ocrReference && (
              <p className="note">
                {copy.ocr}: <strong>{invoice.ocrReference}</strong>
              </p>
            )}
            {accountLines.length === 0 && (
              <p className="note">
                {copy.noAccounts}{" "}
                <Link className="textLink" href="/settings#invoice-payment">
                  {copy.addAccounts}
                </Link>
              </p>
            )}
          </div>
        </article>
        <article className="card">
          <h2>{copy.sent}</h2>
          <div className="stack">
            <p className="note">
              {invoice.sentAt
                ? `${isoDate(invoice.sentAt)}${invoice.emailTo ? `, ${invoice.emailTo}` : ""}`
                : copy.notSent}
            </p>
            <p className="note">
              {copy.reminders}:{" "}
              {invoice.reminderCount > 0 && invoice.lastReminderAt
                ? copy.remindersSent(invoice.reminderCount, isoDate(invoice.lastReminderAt))
                : copy.remindersNone}
            </p>
            {quote && (
              <p className="note">
                {copy.fromQuote}{" "}
                <Link className="textLink" href={`/quotes/${quote.id}`}>
                  {quote.quoteNumber}
                </Link>
              </p>
            )}
            {template && (
              <p className="note">
                {copy.recurring}.{" "}
                <Link className="textLink" href="/invoices#recurring-invoices">
                  {copy.seeRecurring}
                </Link>
              </p>
            )}
          </div>
        </article>
      </div>

      <article className="card">
        <h2>{copy.history}</h2>
        {history.length === 0 ? (
          <p className="note">{copy.historyEmpty}</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.date}</th>
                  <th>{copy.what}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.verification}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.key}>
                    <td>{isoDate(row.date)}</td>
                    <td>
                      {row.label}
                      {row.cancelled ? ` (${copy.cancelled})` : ""}
                      {row.detail && (
                        <>
                          <br />
                          <span className="note">{row.detail}</span>
                        </>
                      )}
                    </td>
                    <td>{row.cancelled ? <s>{money(row.amount)}</s> : money(row.amount)}</td>
                    <td>
                      {row.transactionId ? (
                        <Link className="textLink" href={`/review/transactions/${row.transactionId}`}>
                          {row.verificationNumber ?? copy.verification}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {row.paymentId && !row.cancelled && row.transactionId && (
                        <UndoPaymentButton locale={locale} invoiceId={invoice.id} paymentId={row.paymentId} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note" style={{ marginTop: 12 }}>
          {copy.remaining}: <strong>{money(status.remaining)}</strong>
        </p>
      </article>

      <article className="card">
        <h2>{copy.lines}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.description}</th>
                <th>{copy.quantity}</th>
                <th>{copy.unitPrice}</th>
                <th>{copy.vat}</th>
                <th>{copy.amount}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.description}
                    {rotRut && (
                      <>
                        <br />
                        <span className="note">
                          {item.rotRutLabour
                            ? copy.labourLine(rotRutWorkTypeLabel(item.rotRutWorkType, locale), item.rotRutHours)
                            : item.rotRutWorkType
                              ? copy.materialLine(rotRutWorkTypeLabel(item.rotRutWorkType, locale))
                              : copy.otherLine}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{money(item.unitPrice)}</td>
                  <td>{money(item.vatAmount)}</td>
                  <td>{money(item.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="invoiceTotals">
          <p>
            {copy.subtotal}: <strong>{money(invoice.subtotalAmount)}</strong>
          </p>
          <p>
            {copy.vat}: <strong>{money(invoice.vatAmount)}</strong>
          </p>
          <p>
            {copy.total}: <strong>{money(invoice.grossAmount)}</strong>
          </p>
        </div>
        {invoice.notes && (
          <p className="note">
            {copy.notes}: {invoice.notes}
          </p>
        )}
        <p className="note">{copy.locked}</p>
      </article>
    </section>
  );
}
