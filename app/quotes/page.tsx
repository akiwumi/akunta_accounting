export const dynamic = "force-dynamic";

import Link from "next/link";

import { QuoteActions } from "@/components/quotes/QuoteActions";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { isoDate, stockholmToday } from "@/lib/invoices/dates";
import { effectiveQuoteStatus, type QuoteStatus, quoteStatusLabel } from "@/lib/invoices/quotes";

type QuotesPageProps = { searchParams?: Promise<{ q?: string; status?: string }> };

const badgeClass = (status: QuoteStatus) =>
  status === "ACCEPTED" || status === "INVOICED" ? "badge good" : status === "EXPIRED" ? "badge warn" : "badge";

export default async function QuotesPage(props: QuotesPageProps) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();
  const today = stockholmToday();
  const query = searchParams?.q?.trim() ?? "";
  const statusFilter = searchParams?.status ?? "";

  const copy = sv
    ? {
        title: "Offerter",
        subtitle: "Skicka en offert, se vad kunden svarar och gör om den till en faktura med ett klick.",
        newQuote: "Ny offert",
        search: "Sök",
        searchPlaceholder: "Offertnummer, kund eller projekt",
        status: "Status",
        all: "Alla",
        open: "Väntar på svar",
        show: "Visa",
        number: "Offert",
        customer: "Kund",
        validUntil: "Giltig till",
        amount: "Belopp",
        nextStep: "Nästa steg",
        empty: "Inga offerter ännu. En offert bokförs inte, så du kan ändra den fritt tills den blivit en faktura.",
        noMatch: "Inga offerter matchar.",
        waiting: "Väntar på svar",
        accepted: "Accepterade, ej fakturerade"
      }
    : {
        title: "Quotes",
        subtitle: "Send a quote, see what the customer answers and turn it into an invoice in one click.",
        newQuote: "New quote",
        search: "Search",
        searchPlaceholder: "Quote number, customer or project",
        status: "Status",
        all: "All",
        open: "Awaiting answer",
        show: "Show",
        number: "Quote",
        customer: "Customer",
        validUntil: "Valid until",
        amount: "Amount",
        nextStep: "Next step",
        empty: "No quotes yet. A quote is not booked, so you can change it freely until it has become an invoice.",
        noMatch: "No quotes match.",
        waiting: "Awaiting answer",
        accepted: "Accepted, not invoiced"
      };

  const quotes = await prisma.quote.findMany({
    where: {
      businessId: business.id,
      ...(query
        ? {
            OR: [
              { quoteNumber: { contains: query, mode: "insensitive" } },
              { customerName: { contains: query, mode: "insensitive" } },
              { projectName: { contains: query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 500
  });

  const all = quotes.map((quote) => ({ quote, status: effectiveQuoteStatus(quote, today) }));
  const statuses: QuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "INVOICED"];
  const rows = statuses.includes(statusFilter as QuoteStatus) ? all.filter((row) => row.status === statusFilter) : all;
  const sumOf = (status: QuoteStatus) =>
    all
      .filter((row) => row.status === status && row.quote.currency === business.baseCurrency)
      .reduce((sum, row) => sum + asNumber(row.quote.grossAmount), 0);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <div className="grid">
        <article className="card">
          <p className="label">{copy.waiting}</p>
          <p className="kpi">{formatMoney(sumOf("SENT"), business.baseCurrency, numberLocale)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.accepted}</p>
          <p className="kpi">{formatMoney(sumOf("ACCEPTED"), business.baseCurrency, numberLocale)}</p>
        </article>
        <article className="card">
          <Link className="button" href="/quotes/new">
            {copy.newQuote}
          </Link>
        </article>
      </div>

      <article className="card">
        <form className="row" method="get" style={{ alignItems: "flex-end" }}>
          <label className="stack">
            {copy.search}
            <input name="q" defaultValue={query} placeholder={copy.searchPlaceholder} />
          </label>
          <label className="stack">
            {copy.status}
            <select name="status" defaultValue={statusFilter}>
              <option value="">{copy.all}</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {quoteStatusLabel(status, locale)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">{copy.show}</button>
        </form>
      </article>

      <article className="card" id="quote-list">
        {rows.length === 0 ? (
          <div className="stack">
            <p className="note">{all.length === 0 && !query ? copy.empty : copy.noMatch}</p>
            <div className="row">
              <Link className="button" href="/quotes/new">
                {copy.newQuote}
              </Link>
            </div>
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.number}</th>
                  <th>{copy.customer}</th>
                  <th>{copy.validUntil}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.status}</th>
                  <th>{copy.nextStep}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ quote, status }) => (
                  <tr key={quote.id}>
                    <td>
                      <Link className="textLink" href={`/quotes/${quote.id}`}>
                        {quote.quoteNumber}
                      </Link>
                      <br />
                      <span className="note">{isoDate(quote.issueDate)}</span>
                    </td>
                    <td>
                      {quote.customerId ? (
                        <Link className="textLink" href={`/customers/${quote.customerId}`}>
                          {quote.customerName}
                        </Link>
                      ) : (
                        quote.customerName
                      )}
                      {quote.projectName && (
                        <>
                          <br />
                          <span className="note">{quote.projectName}</span>
                        </>
                      )}
                    </td>
                    <td>{quote.validUntil ? isoDate(quote.validUntil) : "-"}</td>
                    <td>{formatMoney(asNumber(quote.grossAmount), quote.currency, numberLocale)}</td>
                    <td>
                      <span className={badgeClass(status)}>{quoteStatusLabel(status, locale)}</span>
                    </td>
                    <td>
                      <QuoteActions
                        locale={locale}
                        variant="row"
                        quote={{
                          id: quote.id,
                          quoteNumber: quote.quoteNumber,
                          customerEmail: quote.customerEmail,
                          status,
                          invoice: quote.invoice
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
