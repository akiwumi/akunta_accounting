export const dynamic = "force-dynamic";

import Link from "next/link";

import { buildDashboardSummary } from "@/lib/accounting/reports";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { fiscalYearPeriod, formatTaxYearLabel, getFiscalYearStartMonth, parseTaxYear } from "@/lib/data/period";
import { getClosedTaxYearsForBusiness, getLatestClosedTaxYear } from "@/lib/data/taxYears";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

type DashboardPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Bokföringsöversikt",
          setupTitle: "Välj ditt skatteår när du är redo",
          setupBody:
            "Du kan redan öppna alla delar av arbetsytan från menyn till vänster. När du vill kan du gå till Inställningar och välja vilken månad ditt skatteår börjar, så att dashboarden och rapportperioderna blir rätt.",
          setupCta: "Öppna inställningar",
          annual: "Årsbokslut (historik)",
          taxYear: "Skatteår",
          customNote: "Stängda skatteår följer din valda skatteårsperiod i inställningarna.",
          loadYear: "Ladda år",
          revenue: "Intäkter",
          expenses: "Kostnader",
          operatingProfit: "Rörelseresultat",
          vatPayable: "Beräknad moms att betala",
          vatOutput: "Utgående moms (löpande)",
          vatInput: "Ingående moms (löpande)",
          transactions: "Bokförda transaktioner",
          receipts: "Lagrade kvitton",
          exportAccounts: "Exportera hela bokföringen (Excel)",
          companyDetails: "Företagsuppgifter",
          completeProfile: "Fyll i dina företagsuppgifter i inställningarna.",
          openSettings: "Öppna inställningar"
        }
      : {
          title: "Accounting Dashboard",
          setupTitle: "Set your tax year when you're ready",
          setupBody:
            "You can already open every area from the left-hand menu. When you're ready, go to Settings and choose which month your tax year begins so the dashboard and reporting periods line up correctly.",
          setupCta: "Open settings",
          annual: "Annual Books (Historical)",
          taxYear: "Tax Year",
          customNote: "Closed tax years follow your configured tax-year range in settings.",
          loadYear: "Load Year",
          revenue: "Revenue",
          expenses: "Expenses",
          operatingProfit: "Operating Profit",
          vatPayable: "Estimated VAT Payable",
          vatOutput: "Output VAT (Running)",
          vatInput: "Input VAT (Running)",
          transactions: "Transactions Posted",
          receipts: "Receipts Stored",
          exportAccounts: "Export Full Accounts (Excel)",
          companyDetails: "Company Details",
          completeProfile: "Complete your company profile in settings.",
          openSettings: "Open settings"
        };
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";

  const business = await ensureBusiness();
  const fiscalYearStartMonth = getFiscalYearStartMonth(business.fiscalYearStart);
  const closedTaxYears = await getClosedTaxYearsForBusiness(business.id, fiscalYearStartMonth);
  const requestedYear = parseTaxYear(searchParams?.year);
  const selectedYear =
    requestedYear && closedTaxYears.includes(requestedYear)
      ? requestedYear
      : (closedTaxYears[0] ?? getLatestClosedTaxYear(fiscalYearStartMonth));
  const period = fiscalYearPeriod(selectedYear, fiscalYearStartMonth);
  const taxYearLabel = formatTaxYearLabel(selectedYear, fiscalYearStartMonth);
  const [summary, transactionCount, receiptCount] = await Promise.all([
    buildDashboardSummary({ businessId: business.id, ...period }),
    prisma.transaction.count({
      where: {
        businessId: business.id,
        txnDate: {
          gte: period.from,
          lte: period.to
        }
      }
    }),
    prisma.receipt.count({
      where: {
        businessId: business.id,
        OR: [
          {
            receiptDate: {
              gte: period.from,
              lte: period.to
            }
          },
          {
            receiptDate: null,
            createdAt: {
              gte: period.from,
              lte: period.to
            }
          }
        ]
      }
    })
  ]);
  const needsInitialTaxYearSetup =
    transactionCount === 0 &&
    receiptCount === 0 &&
    Math.abs(business.updatedAt.getTime() - business.createdAt.getTime()) < 60_000;

  const hasCompanyDetails = Boolean(
    business.invoiceSenderAddress ||
    business.vatNumber ||
    business.invoiceSenderOrgNumber ||
    business.invoiceSenderPhone ||
    business.invoiceSenderEmail ||
    business.invoiceSenderWebsite
  );

  return (
    <section className="page dashboardPage">
      <h1 className="title">{copy.title}</h1>

      {/* Company details card — shown when fields are filled in settings */}
      <article className="card dashboardCompanyCard">
        <h2>{copy.companyDetails}</h2>
        {hasCompanyDetails ? (
          <div className="dashboardCompanyInfo">
            <p className="dashboardCompanyName">{business.name}</p>
            {business.invoiceSenderAddress && (
              <p className="note" style={{ whiteSpace: "pre-line" }}>{business.invoiceSenderAddress}</p>
            )}
            <div className="dashboardCompanyMeta">
              {business.invoiceSenderOrgNumber && <span>{business.invoiceSenderOrgNumber}</span>}
              {business.vatNumber && <span>VAT: {business.vatNumber}</span>}
              {business.invoiceSenderPhone && <span>{business.invoiceSenderPhone}</span>}
              {business.invoiceSenderEmail && <span>{business.invoiceSenderEmail}</span>}
              {business.invoiceSenderWebsite && <span>{business.invoiceSenderWebsite}</span>}
            </div>
          </div>
        ) : (
          <div className="row dashboardSetupActions">
            <p className="note">{copy.completeProfile}</p>
            <Link className="button secondary" href="/settings">
              {copy.openSettings}
            </Link>
          </div>
        )}
      </article>

      {needsInitialTaxYearSetup ? (
        <article className="card dashboardSetupCard">
          <h2>{copy.setupTitle}</h2>
          <p className="note">{copy.setupBody}</p>
          <div className="row dashboardSetupActions">
            <Link className="button" href="/settings#business-settings">
              {copy.setupCta}
            </Link>
          </div>
        </article>
      ) : null}
      <SectionExportBar locale={locale} section="dashboard" params={{ year: String(selectedYear) }} />
      <div className="row dashboardExportRow" id="dashboard-export-accounts">
        <a className="button" href={`/api/exports/accounts?year=${selectedYear}`}>
          {copy.exportAccounts}
        </a>
      </div>

      <article className="card" id="annual-books">
        <h2>{copy.annual}</h2>
        <form className="row dashboardYearForm" method="get">
          <label className="stack">
            {copy.taxYear}
            <select name="year" defaultValue={String(selectedYear)}>
              {closedTaxYears.map((year) => (
                <option key={year} value={year}>
                  {formatTaxYearLabel(year, fiscalYearStartMonth)}
                </option>
              ))}
            </select>
          </label>
          <div className="row dashboardYearFormActions">
            <button type="submit">{copy.loadYear}</button>
          </div>
        </form>
        <p className="note">{copy.customNote}</p>
      </article>

      <div className="grid dashboardKpiGrid" id="summary-kpis">
        <article className="card dashboardKpiCard">
          <p className="label">
            {copy.revenue} ({taxYearLabel})
          </p>
          <p className="kpi">{formatMoney(summary.revenue, "SEK", numberLocale)}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">
            {copy.expenses} ({taxYearLabel})
          </p>
          <p className="kpi">{formatMoney(summary.expenses, "SEK", numberLocale)}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">
            {copy.operatingProfit} ({taxYearLabel})
          </p>
          <p className="kpi">{formatMoney(summary.operatingProfit, "SEK", numberLocale)}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">{copy.vatPayable}</p>
          <p className="kpi">{formatMoney(summary.vatPayable, "SEK", numberLocale)}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">{copy.vatOutput}</p>
          <p className="kpi">{formatMoney(summary.vatOutput, "SEK", numberLocale)}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">{copy.vatInput}</p>
          <p className="kpi">{formatMoney(summary.vatInput, "SEK", numberLocale)}</p>
        </article>
      </div>

      <div className="grid dashboardActivityGrid" id="activity-summary">
        <article className="card dashboardKpiCard">
          <p className="label">{copy.transactions}</p>
          <p className="kpi">{transactionCount}</p>
        </article>
        <article className="card dashboardKpiCard">
          <p className="label">{copy.receipts}</p>
          <p className="kpi">{receiptCount}</p>
        </article>
      </div>

    </section>
  );
}
