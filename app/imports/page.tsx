import { BankImportForm } from "@/components/forms/BankImportForm";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function ImportsPage() {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Bank-CSV import",
          subtitle: "Manuell CSV-import för bokföring enligt kontantmetoden.",
          history: "Importhistorik",
          date: "Datum",
          file: "Fil",
          imported: "Importerade",
          accepted: "Godkända",
          rejected: "Avvisade",
          none: "Inga importer ännu."
        }
      : {
          title: "Bank CSV Import",
          subtitle: "Manual CSV import for cash-method posting.",
          history: "Import History",
          date: "Date",
          file: "File",
          imported: "Imported",
          accepted: "Accepted",
          rejected: "Rejected",
          none: "No imports yet."
        };

  const business = await ensureBusiness();
  const batches = await prisma.bankImportBatch.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar locale={locale} section="imports" />

      <article className="card" id="import-upload">
        <BankImportForm locale={locale} />
      </article>

      <article className="card" id="import-history">
        <h2>{copy.history}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.file}</th>
                <th>{copy.imported}</th>
                <th>{copy.accepted}</th>
                <th>{copy.rejected}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{new Date(batch.createdAt).toISOString().slice(0, 10)}</td>
                  <td>{batch.fileName}</td>
                  <td>{batch.importedRows}</td>
                  <td>{batch.acceptedRows}</td>
                  <td>{batch.rejectedRows}</td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5}>{copy.none}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
