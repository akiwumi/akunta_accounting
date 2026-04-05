import Link from "next/link";

import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function ReviewPage() {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Granskning av underlag",
          subtitle: "Gå igenom kvitton och manuella inmatningar innan rapportering.",
          needsReview: "Kräver granskning",
          recentReceipts: "Senaste kvitton",
          otherInputs: "Övriga inmatningar (utan kvitto)",
          open: "Öppna",
          date: "Datum",
          source: "Källa",
          description: "Beskrivning",
          noNeedsReview: "Inga kvitton markerade för granskning.",
          noReceipts: "Inga kvitton hittades.",
          noOtherInputs: "Inga övriga inmatningar hittades."
        }
      : {
          title: "Input Review",
          subtitle: "Review receipts and manual inputs before reporting.",
          needsReview: "Needs Review",
          recentReceipts: "Recent Receipts",
          otherInputs: "Other Inputs (without receipt)",
          open: "Open",
          date: "Date",
          source: "Source",
          description: "Description",
          noNeedsReview: "No receipts currently marked for review.",
          noReceipts: "No receipts found.",
          noOtherInputs: "No other input entries found."
        };

  const business = await ensureBusiness();
  const [needsReviewReceipts, recentReceipts, otherInputs] = await Promise.all([
    prisma.receipt.findMany({
      where: {
        businessId: business.id,
        needsReview: true
      },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.receipt.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.transaction.findMany({
      where: {
        businessId: business.id,
        receiptId: null
      },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
      take: 100
    })
  ]);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar locale={locale} section="review" />

      <article className="card" id="needs-review">
        <h2>{copy.needsReview}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.description}</th>
                <th>{copy.source}</th>
                <th>{copy.open}</th>
              </tr>
            </thead>
            <tbody>
              {needsReviewReceipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{receipt.createdAt.toISOString().slice(0, 10)}</td>
                  <td>{receipt.vendor ?? receipt.originalFileName}</td>
                  <td>{receipt.source}</td>
                  <td>
                    <Link href={`/review/receipts/${receipt.id}`}>{copy.open}</Link>
                  </td>
                </tr>
              ))}
              {needsReviewReceipts.length === 0 && (
                <tr>
                  <td colSpan={4}>{copy.noNeedsReview}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" id="recent-receipts">
        <h2>{copy.recentReceipts}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.description}</th>
                <th>{copy.source}</th>
                <th>{copy.open}</th>
              </tr>
            </thead>
            <tbody>
              {recentReceipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{receipt.createdAt.toISOString().slice(0, 10)}</td>
                  <td>{receipt.vendor ?? receipt.originalFileName}</td>
                  <td>{receipt.source}</td>
                  <td>
                    <Link href={`/review/receipts/${receipt.id}`}>{copy.open}</Link>
                  </td>
                </tr>
              ))}
              {recentReceipts.length === 0 && (
                <tr>
                  <td colSpan={4}>{copy.noReceipts}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" id="other-inputs">
        <h2>{copy.otherInputs}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.description}</th>
                <th>{copy.source}</th>
                <th>{copy.open}</th>
              </tr>
            </thead>
            <tbody>
              {otherInputs.map((txn) => (
                <tr key={txn.id}>
                  <td>{txn.txnDate.toISOString().slice(0, 10)}</td>
                  <td>{txn.description}</td>
                  <td>{txn.source}</td>
                  <td>
                    <Link href={`/review/transactions/${txn.id}`}>{copy.open}</Link>
                  </td>
                </tr>
              ))}
              {otherInputs.length === 0 && (
                <tr>
                  <td colSpan={4}>{copy.noOtherInputs}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
