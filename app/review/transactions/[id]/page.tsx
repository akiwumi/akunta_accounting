export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { TransactionEditForm } from "@/components/review/TransactionEditForm";
import { asNumber } from "@/lib/accounting/math";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

type TransactionReviewPageProps = {
  params: {
    id: string;
  };
};

export default async function TransactionReviewPage({ params }: TransactionReviewPageProps) {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Granska post",
          back: "Till granskning",
          details: "Transaktionsdetaljer",
          date: "Datum",
          description: "Beskrivning",
          direction: "Riktning",
          gross: "Brutto",
          net: "Netto",
          vat: "Moms",
          vatRate: "Momssats",
          source: "Källa",
          reference: "Referens",
          invoice: "Faktura",
          openInvoice: "Öppna fakturor",
          receipt: "Kvitto",
          openReceipt: "Öppna kvitto",
          edit: "Redigera",
          journal: "Verifikation",
          account: "Konto",
          accountName: "Kontonamn",
          debit: "Debet",
          credit: "Kredit",
          note: "Notering",
          linkedImports: "Kopplade bankimport-rader",
          batch: "Batch",
          row: "Rad",
          amount: "Belopp",
          status: "Status",
          noImports: "Inga kopplade bankimport-rader."
        }
      : {
          title: "Review Entry",
          back: "Back to review",
          details: "Transaction Details",
          date: "Date",
          description: "Description",
          direction: "Direction",
          gross: "Gross",
          net: "Net",
          vat: "VAT",
          vatRate: "VAT rate",
          source: "Source",
          reference: "Reference",
          invoice: "Invoice",
          openInvoice: "Open invoices",
          receipt: "Receipt",
          openReceipt: "Open receipt",
          edit: "Edit",
          journal: "Journal Lines",
          account: "Account",
          accountName: "Account Name",
          debit: "Debit",
          credit: "Credit",
          note: "Note",
          linkedImports: "Linked Bank Import Rows",
          batch: "Batch",
          row: "Row",
          amount: "Amount",
          status: "Status",
          noImports: "No linked bank import rows."
        };
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";

  const txn = await prisma.transaction.findUnique({
    where: { id: params.id },
    include: {
      receipt: {
        select: {
          id: true,
          vendor: true,
          originalFileName: true
        }
      },
      paidInvoice: {
        select: {
          id: true,
          invoiceNumber: true
        }
      },
      lines: {
        include: {
          account: true
        },
        orderBy: {
          account: {
            code: "asc"
          }
        }
      },
      bankImportRows: {
        include: {
          batch: {
            select: {
              id: true,
              fileName: true
            }
          }
        },
        orderBy: [{ batchId: "desc" }, { rowNumber: "asc" }]
      }
    }
  });

  if (!txn) notFound();

  return (
    <section className="page">
      <div className="row">
        <Link className="button secondary" href="/review">
          {copy.back}
        </Link>
      </div>

      <h1 className="title">{copy.title}</h1>

      <article className="card stack">
        <h2>{copy.details}</h2>
        <p className="note">
          {copy.date}: {txn.txnDate.toISOString().slice(0, 10)}
        </p>
        <p className="note">
          {copy.description}: {txn.description}
        </p>
        <p className="note">
          {copy.direction}: {txn.direction}
        </p>
        <p className="note">
          {copy.gross}: {formatMoney(asNumber(txn.grossAmount), txn.currency, numberLocale)}
        </p>
        <p className="note">
          {copy.net}: {formatMoney(asNumber(txn.netAmount), txn.currency, numberLocale)}
        </p>
        <p className="note">
          {copy.vat}: {formatMoney(asNumber(txn.vatAmount), txn.currency, numberLocale)}
        </p>
        <p className="note">
          {copy.vatRate}: {(asNumber(txn.vatRate) * 100).toFixed(2)}%
        </p>
        <p className="note">
          {copy.source}: {txn.source}
        </p>
        <p className="note">
          {copy.reference}: {txn.reference ?? "-"}
        </p>
        <p className="note">
          {copy.invoice}: {txn.paidInvoice ? `${txn.paidInvoice.invoiceNumber} ` : "-"}
          {txn.paidInvoice ? <Link href="/invoices">{copy.openInvoice}</Link> : null}
        </p>
        <p className="note">
          {copy.receipt}:{" "}
          {txn.receipt ? (
            <Link href={`/review/receipts/${txn.receipt.id}`}>{copy.openReceipt}</Link>
          ) : (
            "-"
          )}
        </p>
      </article>

      <article className="card">
        <h2>{copy.edit}</h2>
        <TransactionEditForm
          transactionId={txn.id}
          locale={locale}
          initial={{
            description: txn.description,
            txnDate: txn.txnDate.toISOString().slice(0, 10),
            reference: txn.reference ?? ""
          }}
        />
      </article>

      <article className="card">
        <h2>{copy.journal}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.account}</th>
                <th>{copy.accountName}</th>
                <th>{copy.debit}</th>
                <th>{copy.credit}</th>
                <th>{copy.note}</th>
              </tr>
            </thead>
            <tbody>
              {txn.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.account.code}</td>
                  <td>{line.account.name}</td>
                  <td>{asNumber(line.debit).toFixed(2)}</td>
                  <td>{asNumber(line.credit).toFixed(2)}</td>
                  <td>{line.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card">
        <h2>{copy.linkedImports}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.batch}</th>
                <th>{copy.row}</th>
                <th>{copy.amount}</th>
                <th>{copy.status}</th>
              </tr>
            </thead>
            <tbody>
              {txn.bankImportRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.batch.fileName}</td>
                  <td>{row.rowNumber}</td>
                  <td>{asNumber(row.amount).toFixed(2)}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
              {txn.bankImportRows.length === 0 && (
                <tr>
                  <td colSpan={4}>{copy.noImports}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
