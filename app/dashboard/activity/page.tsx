export const dynamic = "force-dynamic";

import Link from "next/link";

import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function DashboardActivityPage() {
  const locale = getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";

  const copy = sv
    ? {
        title: "Aktivitet",
        subtitle: "Senaste aktivitet i bokföringen.",
        receipts: "Senaste kvitton",
        invoices: "Senaste fakturor",
        transactions: "Senaste transaktioner",
        noReceipts: "Inga kvitton ännu.",
        noInvoices: "Inga fakturor ännu.",
        noTransactions: "Inga transaktioner ännu.",
        viewAll: "Visa alla",
        date: "Datum",
        vendor: "Leverantör",
        amount: "Belopp",
        status: "Status",
        client: "Kund",
        description: "Beskrivning"
      }
    : {
        title: "Activity",
        subtitle: "Recent bookkeeping activity.",
        receipts: "Recent Receipts",
        invoices: "Recent Invoices",
        transactions: "Recent Transactions",
        noReceipts: "No receipts yet.",
        noInvoices: "No invoices yet.",
        noTransactions: "No transactions yet.",
        viewAll: "View all",
        date: "Date",
        vendor: "Vendor",
        amount: "Amount",
        status: "Status",
        client: "Client",
        description: "Description"
      };

  const business = await ensureBusiness();

  const [receipts, invoices, transactions] = await Promise.all([
    prisma.receipt.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.invoice.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.transaction.findMany({
      where: { businessId: business.id },
      orderBy: { txnDate: "desc" },
      take: 5
    })
  ]);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.receipts}</h2>
          <Link href="/receipts" className="button secondary">{copy.viewAll}</Link>
        </div>
        {receipts.length === 0 ? (
          <p className="note">{copy.noReceipts}</p>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.vendor}</th>
                <th>{copy.amount}</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.receiptDate ? new Date(r.receiptDate).toLocaleDateString(numberLocale) : "—"}</td>
                  <td>{r.vendor ?? "—"}</td>
                  <td>{r.grossAmount != null ? formatMoney(Number(r.grossAmount), r.currency ?? "SEK", numberLocale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.invoices}</h2>
          <Link href="/invoices" className="button secondary">{copy.viewAll}</Link>
        </div>
        {invoices.length === 0 ? (
          <p className="note">{copy.noInvoices}</p>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.client}</th>
                <th>{copy.amount}</th>
                <th>{copy.status}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{new Date(inv.issueDate).toLocaleDateString(numberLocale)}</td>
                  <td>{inv.customerName}</td>
                  <td>{formatMoney(Number(inv.grossAmount), inv.currency ?? "SEK", numberLocale)}</td>
                  <td>{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.transactions}</h2>
          <Link href="/transactions" className="button secondary">{copy.viewAll}</Link>
        </div>
        {transactions.length === 0 ? (
          <p className="note">{copy.noTransactions}</p>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.description}</th>
                <th>{copy.amount}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.txnDate).toLocaleDateString(numberLocale)}</td>
                  <td>{t.description}</td>
                  <td>{formatMoney(Number(t.grossAmount), t.currency ?? "SEK", numberLocale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
