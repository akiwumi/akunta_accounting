import { LedgerTransactionsTable } from "@/components/ledger/LedgerTransactionsTable";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { calendarYearPeriod, parseTaxYear } from "@/lib/data/period";
import { getClosedTaxYearsForBusiness } from "@/lib/data/taxYears";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

type LedgerPageProps = {
  searchParams?: {
    year?: string;
    from?: string;
    to?: string;
    source?: string;
  };
};

const parseDate = (value: string | undefined, endOfDay = false) => {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const parsed = new Date(`${value}${suffix}`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed;
};

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Huvudbok",
          subtitle: "Fullständig lista över bokförda transaktioner.",
          taxYear: "Skatteår",
          customRange: "Eget intervall",
          from: "Från",
          to: "Till",
          source: "Källa",
          allSources: "Alla källor",
          filter: "Filtrera",
          date: "Datum",
          description: "Beskrivning",
          vendor: "Leverantör",
          direction: "Riktning",
          gross: "Brutto",
          vat: "Moms",
          sourceCol: "Källa",
          reference: "Referens",
          journal: "Verifikation",
          input: "Underlag",
          erase: "Radera",
          erasing: "Raderar...",
          none: "Inga transaktioner hittades.",
          reviewReceipt: "Granska kvitto",
          reviewTransaction: "Granska post",
          reviewInput: "Granska underlag",
          deleteConfirm: "Radera den här huvudboksposten?",
          deleteFailed: "Kunde inte radera posten.",
          unknownDeleteError: "Okänt fel vid radering."
        }
      : {
          title: "Ledger",
          subtitle: "Complete register of all posted transactions.",
          taxYear: "Tax Year",
          customRange: "Custom range",
          from: "From",
          to: "To",
          source: "Source",
          allSources: "All sources",
          filter: "Filter",
          date: "Date",
          description: "Description",
          vendor: "Vendor",
          direction: "Direction",
          gross: "Gross",
          vat: "VAT",
          sourceCol: "Source",
          reference: "Reference",
          journal: "Journal",
          input: "Input",
          erase: "Delete",
          erasing: "Deleting...",
          none: "No transactions found.",
          reviewReceipt: "Review receipt",
          reviewTransaction: "Review entry",
          reviewInput: "Review input",
          deleteConfirm: "Delete this ledger entry?",
          deleteFailed: "Failed to delete entry.",
          unknownDeleteError: "Unknown delete error."
        };

  const business = await ensureBusiness();
  const closedTaxYears = await getClosedTaxYearsForBusiness(business.id);
  const requestedYear = parseTaxYear(searchParams?.year);
  const selectedYear =
    requestedYear && closedTaxYears.includes(requestedYear)
      ? requestedYear
      : null;
  const selectedYearPeriod = selectedYear ? calendarYearPeriod(selectedYear) : null;

  const from = selectedYearPeriod?.from ?? parseDate(searchParams?.from);
  const to = selectedYearPeriod?.to ?? parseDate(searchParams?.to, true);
  const fromInputValue = selectedYearPeriod?.from.toISOString().slice(0, 10) ?? searchParams?.from ?? "";
  const toInputValue = selectedYearPeriod?.to.toISOString().slice(0, 10) ?? searchParams?.to ?? "";
  const sourceFilter = searchParams?.source?.trim();

  const transactions = await prisma.transaction.findMany({
    where: {
      businessId: business.id,
      ...(from || to
        ? {
            txnDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {})
            }
          }
        : {}),
      ...(sourceFilter ? { source: sourceFilter } : {})
    },
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
          customerName: true,
          invoiceNumber: true
        }
      },
      lines: {
        include: {
          account: true
        }
      }
    },
    orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
    take: 500
  });

  const sources = await prisma.transaction.findMany({
    where: { businessId: business.id },
    select: { source: true },
    distinct: ["source"],
    orderBy: { source: "asc" }
  });

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar
        locale={locale}
        section="ledger"
        params={{
          year: selectedYear ? String(selectedYear) : undefined,
          from: selectedYear ? undefined : searchParams?.from,
          to: selectedYear ? undefined : searchParams?.to,
          source: sourceFilter
        }}
      />

      <article className="card" id="ledger-filters">
        <form className="row" method="get">
          <label className="stack">
            {copy.taxYear}
            <select name="year" defaultValue={selectedYear ? String(selectedYear) : ""}>
              <option value="">{copy.customRange}</option>
              {closedTaxYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            {copy.from}
            <input type="date" name="from" defaultValue={fromInputValue} />
          </label>
          <label className="stack">
            {copy.to}
            <input type="date" name="to" defaultValue={toInputValue} />
          </label>
          <label className="stack">
            {copy.source}
            <select name="source" defaultValue={sourceFilter ?? ""}>
              <option value="">{copy.allSources}</option>
              {sources.map((source) => (
                <option key={source.source} value={source.source}>
                  {source.source}
                </option>
              ))}
            </select>
          </label>
          <div className="row" style={{ alignItems: "end" }}>
            <button type="submit">{copy.filter}</button>
          </div>
        </form>
      </article>

      <article className="card" id="ledger-entries">
        <LedgerTransactionsTable
          locale={locale}
          rows={transactions.map((txn) => ({
            id: txn.id,
            txnDate: txn.txnDate.toISOString(),
            description: txn.description,
            vendor: txn.receipt?.vendor ?? txn.paidInvoice?.customerName ?? null,
            direction: txn.direction,
            grossAmount: asNumber(txn.grossAmount),
            vatAmount: asNumber(txn.vatAmount),
            currency: txn.currency,
            source: txn.source,
            reference: txn.reference ?? null,
            journal: txn.lines
              .map((line) => {
                const debit = asNumber(line.debit);
                const credit = asNumber(line.credit);
                const amount = debit > 0 ? `D ${debit.toFixed(2)}` : `C ${credit.toFixed(2)}`;
                return `${line.account.code} ${amount}`;
              })
              .join(" | "),
            receiptId: txn.receipt?.id ?? null
          }))}
          copy={{
            date: copy.date,
            description: copy.description,
            vendor: copy.vendor,
            direction: copy.direction,
            gross: copy.gross,
            vat: copy.vat,
            sourceCol: copy.sourceCol,
            reference: copy.reference,
            journal: copy.journal,
            input: copy.input,
            erase: copy.erase,
            erasing: copy.erasing,
            none: copy.none,
            reviewReceipt: copy.reviewReceipt,
            reviewTransaction: copy.reviewTransaction,
            deleteConfirm: copy.deleteConfirm,
            deleteFailed: copy.deleteFailed,
            unknownDeleteError: copy.unknownDeleteError
          }}
        />
      </article>
    </section>
  );
}
