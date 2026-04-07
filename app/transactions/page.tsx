export const dynamic = "force-dynamic";

import Link from "next/link";

import { PaymentReceivedForm } from "@/components/forms/PaymentReceivedForm";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function TransactionsPage() {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Transaktionsjournal",
          subtitle: "Dubbla bokföringsposter skapade från kvitton och bankimporter.",
          addPayment: "Lägg till betalning in",
          date: "Datum",
          description: "Beskrivning",
          direction: "Riktning",
          gross: "Brutto",
          vat: "Moms",
          source: "Källa",
          journal: "Verifikation",
          review: "Granska",
          none: "Inga transaktioner bokförda ännu."
        }
      : {
          title: "Transactions Ledger",
          subtitle: "Double-entry postings generated from receipts and bank imports.",
          addPayment: "Add Payment Received",
          date: "Date",
          description: "Description",
          direction: "Direction",
          gross: "Gross",
          vat: "VAT",
          source: "Source",
          journal: "Journal",
          review: "Review",
          none: "No transactions posted yet."
        };
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";

  const business = await ensureBusiness();
  const transactions = await prisma.transaction.findMany({
    where: { businessId: business.id },
    include: {
      lines: {
        include: {
          account: true
        }
      }
    },
    orderBy: {
      txnDate: "desc"
    },
    take: 50
  });

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar locale={locale} section="transactions" />

      <article className="card" id="add-payment">
        <h2>{copy.addPayment}</h2>
        <PaymentReceivedForm locale={locale} />
      </article>

      <article className="card" id="transaction-list">
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.description}</th>
                <th>{copy.direction}</th>
                <th>{copy.gross}</th>
                <th>{copy.vat}</th>
                <th>{copy.source}</th>
                <th>{copy.journal}</th>
                <th>{copy.review}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id}>
                  <td>{new Date(txn.txnDate).toISOString().slice(0, 10)}</td>
                  <td>{txn.description}</td>
                  <td>{txn.direction}</td>
                  <td>{formatMoney(asNumber(txn.grossAmount as unknown as number | string), txn.currency, numberLocale)}</td>
                  <td>{formatMoney(asNumber(txn.vatAmount as unknown as number | string), txn.currency, numberLocale)}</td>
                  <td>{txn.source}</td>
                  <td>
                    {txn.lines
                      .map((line) => {
                        const debit = asNumber(line.debit as unknown as number | string);
                        const credit = asNumber(line.credit as unknown as number | string);
                        const amount = debit > 0 ? `D ${debit.toFixed(2)}` : `C ${credit.toFixed(2)}`;
                        return `${line.account.code} ${amount}`;
                      })
                      .join(" | ")}
                  </td>
                  <td>
                    {txn.receiptId ? (
                      <Link href={`/review/receipts/${txn.receiptId}`}>{copy.review}</Link>
                    ) : (
                      <Link href={`/review/transactions/${txn.id}`}>{copy.review}</Link>
                    )}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={8}>{copy.none}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
