export const dynamic = "force-dynamic";

import { SieExportCard } from "@/components/sie/SieExportCard";
import { SieImportCard } from "@/components/sie/SieImportCard";
import { getAuthContext } from "@/lib/auth/context";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { SIE_AUDIT_ENTITY } from "@/lib/sie/import";

type ImportLogEntry = {
  id: string;
  date: string;
  fileName: string;
  vouchers: number;
  numbers: string;
};

const readImportLog = (rows: Array<{ id: string; createdAt: Date; afterJson: string | null }>): ImportLogEntry[] =>
  rows.map((row) => {
    let after: { fileName?: string | null; vouchersImported?: number; firstVerificationNumber?: number | null; lastVerificationNumber?: number | null } = {};
    try {
      after = row.afterJson ? JSON.parse(row.afterJson) : {};
    } catch {
      after = {};
    }
    return {
      id: row.id,
      date: row.createdAt.toISOString().slice(0, 10),
      fileName: after.fileName ?? "",
      vouchers: after.vouchersImported ?? 0,
      numbers:
        after.firstVerificationNumber && after.lastVerificationNumber
          ? `${after.firstVerificationNumber} – ${after.lastVerificationNumber}`
          : ""
    };
  });

export default async function SiePage() {
  const locale = await getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Flytta bokföring",
          subtitle:
            "SIE är det svenska standardformatet för att flytta bokföring mellan program. Här tar du in din bokföring från ett annat program, eller tar ut den till din redovisningskonsult.",
          history: "Tidigare importer",
          date: "Datum",
          file: "Fil",
          vouchers: "Verifikationer",
          numbers: "Ver.nr i Akunta"
        }
      : {
          title: "Move your books",
          subtitle:
            "SIE is the Swedish standard format for moving bookkeeping between programs. Bring your books in from another program here, or take them out for your accountant.",
          history: "Earlier imports",
          date: "Date",
          file: "File",
          vouchers: "Verifications",
          numbers: "Ver. no. in Akunta"
        };

  // The signed-in user's business; the shared helper covers local development.
  const auth = await getAuthContext();
  const businessId = auth?.businessId ?? (await ensureBusiness()).id;

  const [range, openingYears, importRows] = await Promise.all([
    prisma.transaction.aggregate({ where: { businessId }, _min: { txnDate: true }, _max: { txnDate: true } }),
    prisma.openingBalance.findMany({ where: { businessId }, distinct: ["fiscalYear"], select: { fiscalYear: true } }),
    prisma.auditLog.findMany({
      where: { businessId, entityType: SIE_AUDIT_ENTITY, action: "IMPORT" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, createdAt: true, afterJson: true }
    })
  ]);

  const yearSet = new Set<number>(openingYears.map((row) => row.fiscalYear));
  if (range._min.txnDate && range._max.txnDate) {
    for (let year = range._min.txnDate.getUTCFullYear(); year <= range._max.txnDate.getUTCFullYear(); year += 1) {
      yearSet.add(year);
    }
  }
  const years = [...yearSet].sort((a, b) => b - a);
  const imports = readImportLog(importRows);

  const importCard = (
    <article className="card" id="sie-import" key="import">
      <SieImportCard locale={locale} />
    </article>
  );
  const exportCard = (
    <article className="card" id="sie-export" key="export">
      <SieExportCard locale={locale} years={years} />
    </article>
  );

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      {/* With empty books the next step is to bring them in; otherwise taking them out is the common errand. */}
      {years.length === 0 ? [importCard, exportCard] : [exportCard, importCard]}

      {imports.length > 0 && (
        <article className="card" id="sie-history">
          <h2>{copy.history}</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.date}</th>
                  <th>{copy.file}</th>
                  <th>{copy.vouchers}</th>
                  <th>{copy.numbers}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={copy.date}>{entry.date}</td>
                    <td data-label={copy.file}>{entry.fileName}</td>
                    <td data-label={copy.vouchers}>{entry.vouchers}</td>
                    <td data-label={copy.numbers}>{entry.numbers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
