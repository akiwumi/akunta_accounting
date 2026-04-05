import { ReportsRunner } from "@/components/reports/ReportsRunner";
import { ensureBusiness } from "@/lib/data/business";
import { parseTaxYear } from "@/lib/data/period";
import { getClosedTaxYearsForBusiness, getLatestClosedTaxYear } from "@/lib/data/taxYears";
import { getRequestLocale } from "@/lib/i18n/locale";

type ReportsPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Finansiella rapporter",
          subtitle: "Skapa rapporter i realtid och exportera årsdata.",
          hint: "Välj ett stängt skatteår (januari-december) för historiska böcker."
        }
      : {
          title: "Financial Reports",
          subtitle: "Generate real-time reports and export annual data.",
          hint: "Select a closed tax year (January-December) for historical books."
        };
  const business = await ensureBusiness();
  const closedYears = await getClosedTaxYearsForBusiness(business.id);
  const requestedYear = parseTaxYear(searchParams?.year);
  const selectedYear =
    requestedYear && closedYears.includes(requestedYear)
      ? requestedYear
      : (closedYears[0] ?? getLatestClosedTaxYear());

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <p className="note">{copy.hint}</p>

      <article className="card" id="report-runner">
        <ReportsRunner locale={locale} closedYears={closedYears} initialYear={selectedYear} />
      </article>
    </section>
  );
}
