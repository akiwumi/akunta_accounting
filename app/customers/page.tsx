export const dynamic = "force-dynamic";

import Link from "next/link";

import { CustomerForm } from "@/components/customers/CustomerForm";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { invoiceBalanceInclude } from "@/lib/invoices/balance";
import { stockholmToday } from "@/lib/invoices/dates";
import { summarizeOpenInvoices, toInvoiceRow } from "@/lib/invoices/view";

type CustomersPageProps = { searchParams?: Promise<{ q?: string }> };

export default async function CustomersPage(props: CustomersPageProps) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();
  const query = searchParams?.q?.trim() ?? "";
  const today = stockholmToday();

  const copy = sv
    ? {
        title: "Kunder",
        subtitle: "Alla du fakturerar, med vad de är skyldiga och vad som är försenat.",
        search: "Sök kund",
        searchPlaceholder: "Namn, e-post eller telefon",
        searchButton: "Sök",
        clear: "Visa alla",
        newCustomer: "Ny kund",
        name: "Kund",
        contact: "Kontakt",
        invoices: "Fakturor",
        outstanding: "Obetalt",
        overdue: "Försenat",
        action: "Nästa steg",
        newInvoice: "Ny faktura",
        empty: "Du har inga kunder ännu. Lägg till din första här nedanför, eller skriv in kunden direkt när du skapar en faktura.",
        noMatch: (q: string) => `Ingen kund matchar "${q}".`,
        totalOutstanding: "Obetalt totalt",
        totalOverdue: "Varav försenat",
        count: "Antal kunder",
        otherCurrency: "Belopp i annan valuta än företagets visas på kundens sida."
      }
    : {
        title: "Customers",
        subtitle: "Everyone you invoice, with what they owe and what is overdue.",
        search: "Find a customer",
        searchPlaceholder: "Name, email or phone",
        searchButton: "Search",
        clear: "Show all",
        newCustomer: "New customer",
        name: "Customer",
        contact: "Contact",
        invoices: "Invoices",
        outstanding: "Unpaid",
        overdue: "Overdue",
        action: "Next step",
        newInvoice: "New invoice",
        empty: "You have no customers yet. Add your first one below, or type the customer in when you create an invoice.",
        noMatch: (q: string) => `No customer matches "${q}".`,
        totalOutstanding: "Unpaid in total",
        totalOverdue: "Of which overdue",
        count: "Customers",
        otherCurrency: "Amounts in a currency other than the business currency are shown on the customer's page."
      };

  const [customers, openInvoices, totalCustomers] = await Promise.all([
    prisma.customer.findMany({
      where: {
        businessId: business.id,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
                { phone: { contains: query } }
              ]
            }
          : {})
      },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        _count: { select: { invoices: true } }
      }
    }),
    prisma.invoice.findMany({
      where: { businessId: business.id, status: { in: ["UNPAID", "PARTIAL"] }, currency: business.baseCurrency },
      include: invoiceBalanceInclude,
      take: 2000
    }),
    prisma.customer.count({ where: { businessId: business.id } })
  ]);

  const openRows = openInvoices.map((invoice) => toInvoiceRow(invoice, today, locale));
  const byCustomer = new Map<string, { outstanding: number; overdue: number }>();
  for (const row of openRows) {
    if (!row.customerId) continue;
    const entry = byCustomer.get(row.customerId) ?? { outstanding: 0, overdue: 0 };
    entry.outstanding += row.remaining;
    if (row.overdue) entry.overdue += row.remaining;
    byCustomer.set(row.customerId, entry);
  }
  const totals = summarizeOpenInvoices(openRows);
  const money = (value: number) => formatMoney(value, business.baseCurrency, numberLocale);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <div className="grid">
        <article className="card">
          <p className="label">{copy.totalOutstanding}</p>
          <p className="kpi">{money(totals.outstanding)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.totalOverdue}</p>
          <p className="kpi">{money(totals.overdue)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.count}</p>
          <p className="kpi">{totalCustomers}</p>
        </article>
      </div>

      <article className="card">
        <form className="row" method="get" style={{ alignItems: "flex-end" }}>
          <label className="stack">
            {copy.search}
            <input name="q" defaultValue={query} placeholder={copy.searchPlaceholder} />
          </label>
          <button type="submit">{copy.searchButton}</button>
          {query && (
            <Link className="textLink" href="/customers">
              {copy.clear}
            </Link>
          )}
        </form>
      </article>

      <article className="card" id="customer-list">
        {customers.length === 0 ? (
          <p className="note">{query ? copy.noMatch(query) : copy.empty}</p>
        ) : (
          <>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{copy.name}</th>
                    <th>{copy.contact}</th>
                    <th>{copy.invoices}</th>
                    <th>{copy.outstanding}</th>
                    <th>{copy.overdue}</th>
                    <th>{copy.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const balance = byCustomer.get(customer.id) ?? { outstanding: 0, overdue: 0 };
                    return (
                      <tr key={customer.id}>
                        <td>
                          <Link className="textLink" href={`/customers/${customer.id}`}>
                            {customer.name}
                          </Link>
                          {customer.city && (
                            <>
                              <br />
                              <span className="note">{customer.city}</span>
                            </>
                          )}
                        </td>
                        <td>{customer.email || customer.phone || "-"}</td>
                        <td>{customer._count.invoices}</td>
                        <td>{money(balance.outstanding)}</td>
                        <td>
                          {balance.overdue > 0 ? (
                            <span className="badge warn">{money(balance.overdue)}</span>
                          ) : (
                            money(0)
                          )}
                        </td>
                        <td>
                          <Link className="button secondary" href={`/invoices?customer=${customer.id}#new-invoice`}>
                            {copy.newInvoice}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: 12 }}>
              {copy.otherCurrency}
            </p>
          </>
        )}
      </article>

      <article className="card" id="new-customer">
        <h2>{copy.newCustomer}</h2>
        <CustomerForm locale={locale} />
      </article>
    </section>
  );
}
