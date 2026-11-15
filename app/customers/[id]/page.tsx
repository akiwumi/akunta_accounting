export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { CustomerForm } from "@/components/customers/CustomerForm";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { invoiceBalanceInclude } from "@/lib/invoices/balance";
import { isoDate, stockholmToday } from "@/lib/invoices/dates";
import { effectiveQuoteStatus, quoteStatusLabel } from "@/lib/invoices/quotes";
import { toInvoiceRow } from "@/lib/invoices/view";

type CustomerPageProps = { params: Promise<{ id: string }> };

export default async function CustomerPage(props: CustomerPageProps) {
  const { id } = await props.params;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();
  const today = stockholmToday();

  const customer = await prisma.customer.findFirst({
    where: { id, businessId: business.id },
    include: {
      invoices: {
        include: invoiceBalanceInclude,
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: 300
      },
      quotes: { orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], take: 200 }
    }
  });
  if (!customer) notFound();

  const rows = customer.invoices.map((invoice) => toInvoiceRow(invoice, today, locale));

  // Sums per currency, so a customer invoiced in both SEK and EUR is shown honestly.
  const perCurrency = new Map<string, { invoiced: number; outstanding: number; overdue: number }>();
  for (const row of rows) {
    const entry = perCurrency.get(row.currency) ?? { invoiced: 0, outstanding: 0, overdue: 0 };
    entry.invoiced += row.grossAmount - row.creditedAmount;
    entry.outstanding += row.remaining;
    if (row.overdue) entry.overdue += row.remaining;
    perCurrency.set(row.currency, entry);
  }
  if (perCurrency.size === 0) perCurrency.set(business.baseCurrency, { invoiced: 0, outstanding: 0, overdue: 0 });
  const sums = (pick: (entry: { invoiced: number; outstanding: number; overdue: number }) => number) =>
    [...perCurrency.entries()].map(([currency, entry]) => formatMoney(pick(entry), currency, numberLocale)).join(" + ");

  const copy = sv
    ? {
        back: "Alla kunder",
        outstanding: "Obetalt",
        overdue: "Försenat",
        invoiced: "Fakturerat totalt",
        newInvoice: "Ny faktura till kunden",
        newQuote: "Ny offert till kunden",
        invoices: "Fakturor",
        noInvoices: "Inga fakturor till den här kunden ännu.",
        quotes: "Offerter",
        noQuotes: "Inga offerter till den här kunden ännu.",
        number: "Nummer",
        date: "Datum",
        dueDate: "Förfallodatum",
        validUntil: "Giltig till",
        amount: "Belopp",
        remaining: "Kvar att betala",
        status: "Status",
        details: "Kunduppgifter",
        detailsNote: "Ändringar gäller nya fakturor och offerter. Fakturor som redan är utfärdade behåller uppgifterna de skapades med.",
        deleteBlocked: (invoices: number, quotes: number) =>
          `Kunden kan inte tas bort eftersom den har ${[
            invoices > 0 ? `${invoices} ${invoices === 1 ? "faktura" : "fakturor"}` : "",
            quotes > 0 ? `${quotes} ${quotes === 1 ? "offert" : "offerter"}` : ""
          ]
            .filter(Boolean)
            .join(" och ")}. Fakturor är räkenskapsmaterial och ska sparas i sju år.`
      }
    : {
        back: "All customers",
        outstanding: "Unpaid",
        overdue: "Overdue",
        invoiced: "Invoiced in total",
        newInvoice: "New invoice for this customer",
        newQuote: "New quote for this customer",
        invoices: "Invoices",
        noInvoices: "No invoices for this customer yet.",
        quotes: "Quotes",
        noQuotes: "No quotes for this customer yet.",
        number: "Number",
        date: "Date",
        dueDate: "Due date",
        validUntil: "Valid until",
        amount: "Amount",
        remaining: "Left to pay",
        status: "Status",
        details: "Customer details",
        detailsNote: "Changes apply to new invoices and quotes. Invoices already issued keep the details they were created with.",
        deleteBlocked: (invoices: number, quotes: number) =>
          `This customer cannot be deleted because it has ${[
            invoices > 0 ? `${invoices} ${invoices === 1 ? "invoice" : "invoices"}` : "",
            quotes > 0 ? `${quotes} ${quotes === 1 ? "quote" : "quotes"}` : ""
          ]
            .filter(Boolean)
            .join(" and ")}. Invoices are accounting records and must be kept for seven years.`
      };

  const hasDocuments = customer.invoices.length > 0 || customer.quotes.length > 0;

  return (
    <section className="page">
      <p className="note">
        <Link className="textLink" href="/customers">
          {copy.back}
        </Link>
      </p>
      <h1 className="title">{customer.name}</h1>
      <p className="subtitle">{[customer.email, customer.phone, customer.city].filter(Boolean).join(", ") || "-"}</p>

      <div className="grid">
        <article className="card">
          <p className="label">{copy.outstanding}</p>
          <p className="kpi">{sums((entry) => entry.outstanding)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.overdue}</p>
          <p className="kpi">{sums((entry) => entry.overdue)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.invoiced}</p>
          <p className="kpi">{sums((entry) => entry.invoiced)}</p>
        </article>
      </div>

      <div className="row">
        <Link className="button" href={`/invoices?customer=${customer.id}#new-invoice`}>
          {copy.newInvoice}
        </Link>
        <Link className="button secondary" href={`/quotes/new?customer=${customer.id}`}>
          {copy.newQuote}
        </Link>
      </div>

      <article className="card">
        <h2>{copy.invoices}</h2>
        {rows.length === 0 ? (
          <p className="note">{copy.noInvoices}</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.number}</th>
                  <th>{copy.date}</th>
                  <th>{copy.dueDate}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.remaining}</th>
                  <th>{copy.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="textLink" href={`/invoices/${row.id}`}>
                        {row.invoiceNumber}
                      </Link>
                    </td>
                    <td>{row.issueDate.slice(0, 10)}</td>
                    <td>{row.dueDate ? row.dueDate.slice(0, 10) : "-"}</td>
                    <td>{formatMoney(row.grossAmount, row.currency, numberLocale)}</td>
                    <td>
                      <strong>{formatMoney(row.remaining, row.currency, numberLocale)}</strong>
                    </td>
                    <td>
                      <span className={`badge ${row.statusTone}`.trim()}>{row.statusLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card">
        <h2>{copy.quotes}</h2>
        {customer.quotes.length === 0 ? (
          <p className="note">{copy.noQuotes}</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.number}</th>
                  <th>{copy.date}</th>
                  <th>{copy.validUntil}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.status}</th>
                </tr>
              </thead>
              <tbody>
                {customer.quotes.map((quote) => {
                  const status = effectiveQuoteStatus(quote, today);
                  return (
                    <tr key={quote.id}>
                      <td>
                        <Link className="textLink" href={`/quotes/${quote.id}`}>
                          {quote.quoteNumber}
                        </Link>
                      </td>
                      <td>{isoDate(quote.issueDate)}</td>
                      <td>{quote.validUntil ? isoDate(quote.validUntil) : "-"}</td>
                      <td>{formatMoney(asNumber(quote.grossAmount), quote.currency, numberLocale)}</td>
                      <td>
                        <span className={status === "ACCEPTED" || status === "INVOICED" ? "badge good" : status === "EXPIRED" ? "badge warn" : "badge"}>
                          {quoteStatusLabel(status, locale)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card">
        <h2>{copy.details}</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          {copy.detailsNote}
        </p>
        <CustomerForm
          locale={locale}
          customerId={customer.id}
          initial={{
            name: customer.name,
            email: customer.email ?? "",
            phone: customer.phone ?? "",
            website: customer.website ?? "",
            addressLine1: customer.addressLine1 ?? "",
            addressLine2: customer.addressLine2 ?? "",
            postalCode: customer.postalCode ?? "",
            city: customer.city ?? "",
            country: customer.country ?? "",
            notes: customer.notes ?? ""
          }}
          deleteBlockedReason={hasDocuments ? copy.deleteBlocked(customer.invoices.length, customer.quotes.length) : null}
        />
      </article>
    </section>
  );
}
