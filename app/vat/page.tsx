export const dynamic = "force-dynamic";

import Link from "next/link";

import { SKV_LINKS, vatHref } from "@/components/vat/links";
import { VatCheckStep, VatFileStep, VatReviewStep, type VatPageCheck } from "@/components/vat/VatSteps";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { loadUnreportedInvoiceVat } from "@/lib/invoices/balance";
import {
  buildMomsdeklaration,
  filedBoxes,
  findMomsFilings,
  matchMomsFiling,
  resolveOrgNr,
  vatActiveFrom
} from "@/lib/tax/momsdeklaration";
import {
  daysUntil,
  findVatPeriod,
  formatVatDate,
  listVatPeriods,
  pickDefaultVatPeriod,
  swedishToday,
  vatPeriodLabel,
  vatPeriodOptionsFor,
  vatPeriodStatus,
  type VatDeadlineRule,
  type VatPeriodStatus
} from "@/lib/tax/vat-periods";

type Step = "check" | "review" | "file";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function VatPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const money = (value: number) => formatMoney(value, "SEK", numberLocale);

  const copy = sv
    ? {
        title: "Momsdeklaration",
        subtitle:
          "Akunta räknar fram din momsdeklaration ruta för ruta och ger dig filen som du laddar upp hos Skatteverket. Tre steg: kontrollera, granska, lämna in.",
        pay: "Du ska betala",
        refund: "Du får tillbaka",
        zero: "Ingen moms att betala",
        nothingYet: "Inget att redovisa ännu",
        nothingYetText: "Det finns inget bokfört i den här perioden. Beloppet fylls i allt eftersom du bokför.",
        preliminary: "Preliminärt, perioden pågår",
        by: (d: string) => `Lämna in och betala senast ${d}`,
        byRefund: (d: string) => `Lämna in senast ${d}`,
        daysLeft: (n: number) => (n === 0 ? "Det är i dag." : n === 1 ? "Det är i morgon." : `${n} dagar kvar.`),
        daysLate: (n: number) => (n === 1 ? "Sista dag var i går." : `Sista dag var för ${n} dagar sedan.`),
        lateText:
          "Lämna in så snart du kan. Skatteverket tar ut en förseningsavgift och ränta på det som betalas för sent.",
        filedOn: (d: string) => `Inlämnad ${d}`,
        steps: { check: "1. Kontrollera", review: "2. Granska", file: "3. Lämna in" },
        periodsHeading: "Alla perioder",
        periodsIntro: (f: string) => `Du redovisar moms ${f}. Det ändrar du under Inställningar.`,
        frequency: { monthly: "varje månad", quarterly: "varje kvartal", yearly: "en gång per år" },
        period: "Period",
        deadline: "Sista dag",
        status: "Status",
        open: "Öppna",
        current: "Visas",
        statusLabel: { upcoming: "Kommande", ready: "Klar att lämna in", overdue: "Försenad", filed: "Inlämnad" },
        source: "Källa: Skatteverket, När ska jag deklarera moms",
        moved: "Den ordinarie dagen är en helgdag, så sista dag flyttas till nästa vardag.",
        notRegistered:
          "Företaget är inte markerat som momsregistrerat. Är du inte momsregistrerad ska du inte lämna någon momsdeklaration.",
        settings: "Öppna inställningar"
      }
    : {
        title: "VAT return",
        subtitle:
          "Akunta works out your VAT return (momsdeklaration) box by box and gives you the file to upload at Skatteverket. Three steps: check, review, file.",
        pay: "You pay",
        refund: "You get back",
        zero: "No VAT to pay",
        nothingYet: "Nothing to report yet",
        nothingYetText: "Nothing is booked in this period. The amount fills in as you book.",
        preliminary: "Preliminary, the period is still running",
        by: (d: string) => `File and pay by ${d}`,
        byRefund: (d: string) => `File by ${d}`,
        daysLeft: (n: number) => (n === 0 ? "That is today." : n === 1 ? "That is tomorrow." : `${n} days left.`),
        daysLate: (n: number) => (n === 1 ? "The deadline was yesterday." : `The deadline was ${n} days ago.`),
        lateText: "File as soon as you can. Skatteverket charges a late fee, and interest on what is paid late.",
        filedOn: (d: string) => `Filed ${d}`,
        steps: { check: "1. Check", review: "2. Review", file: "3. File" },
        periodsHeading: "All periods",
        periodsIntro: (f: string) => `You report VAT ${f}. You change that under Settings.`,
        frequency: { monthly: "every month", quarterly: "every quarter", yearly: "once a year" },
        period: "Period",
        deadline: "Deadline",
        status: "Status",
        open: "Open",
        current: "Showing",
        statusLabel: { upcoming: "Upcoming", ready: "Ready to file", overdue: "Overdue", filed: "Filed" },
        source: "Source: Skatteverket, När ska jag deklarera moms (when to file)",
        moved: "The regular day is a public holiday or weekend, so the deadline moves to the next working day.",
        notRegistered:
          "The business is not marked as VAT registered. If you are not VAT registered you do not file a VAT return.",
        settings: "Open settings"
      };

  /** The rule behind the deadline, with the assumptions Akunta has to make. */
  const deadlineRuleText = (rule: VatDeadlineRule, euDeadline: Date | null): string => {
    const eu = euDeadline ? formatVatDate(euDeadline, locale) : "";
    if (sv) {
      switch (rule) {
        case "monthly12":
        case "monthly17":
          return "Månadsmoms lämnas senast den 12:e i andra månaden efter perioden, den 17:e i januari och augusti. Akunta utgår från att din omsättning är högst 40 miljoner kronor per år. Är den högre gäller den 26:e i månaden efter perioden.";
        case "monthly26":
          return "Med en omsättning över 40 miljoner kronor lämnas månadsmoms senast den 26:e i månaden efter perioden, den 27:e i december.";
        case "quarterly12":
        case "quarterly17":
          return "Kvartalsmoms lämnas senast den 12:e i andra månaden efter kvartalet, den 17:e i augusti.";
        case "yearlySoleTrader":
          return `Enskild firma med helårsmoms lämnar senast den 12 maj året efter. Akunta vet inte om du har handlat med andra EU-länder och utgår från att du inte har det. Har du köpt eller sålt varor eller tjänster inom EU under året gäller ${eu} i stället.`;
        case "yearlySoleTraderEu":
          return "Enskild firma med helårsmoms och EU-handel lämnar senast den 26 februari året efter.";
        case "yearlyCompany":
          return "Bolag med helårsmoms lämnar momsdeklarationen tillsammans med inkomstdeklarationen. Datumet gäller digital inlämning och förutsätter att bolaget inte har EU-handel. Med EU-handel gäller den 26:e i andra månaden efter räkenskapsårets slut.";
        case "yearlyCompanyEu":
          return "Bolag med helårsmoms och EU-handel lämnar senast den 26:e i andra månaden efter räkenskapsårets slut.";
      }
    }
    switch (rule) {
      case "monthly12":
      case "monthly17":
        return "Monthly VAT is due on the 12th of the second month after the period, the 17th in January and August. Akunta assumes your turnover is at most SEK 40 million a year. Above that, the 26th of the month after the period applies.";
      case "monthly26":
        return "With a turnover above SEK 40 million, monthly VAT is due on the 26th of the month after the period, the 27th in December.";
      case "quarterly12":
      case "quarterly17":
        return "Quarterly VAT is due on the 12th of the second month after the quarter, the 17th in August.";
      case "yearlySoleTrader":
        return `A sole trader (enskild firma) reporting VAT yearly files by 12 May the year after. Akunta does not know whether you traded with other EU countries and assumes you did not. If you bought or sold goods or services within the EU during the year, ${eu} applies instead.`;
      case "yearlySoleTraderEu":
        return "A sole trader reporting VAT yearly with EU trade files by 26 February the year after.";
      case "yearlyCompany":
        return "A company reporting VAT yearly files the VAT return together with its income tax return. The date is for digital filing and assumes no EU trade. With EU trade, the 26th of the second month after the fiscal year ends applies.";
      case "yearlyCompanyEu":
        return "A company reporting VAT yearly with EU trade files by the 26th of the second month after the fiscal year ends.";
    }
  };

  const business = await ensureBusiness();

  const options = vatPeriodOptionsFor(business);
  const today = swedishToday();
  const [filings, locks, activeFrom] = await Promise.all([
    findMomsFilings(business.id),
    prisma.periodLock.findMany({ where: { businessId: business.id }, select: { periodStart: true, periodEnd: true } }),
    vatActiveFrom(business)
  ]);

  const rows = listVatPeriods(options, new Date(), activeFrom).map((period) => {
    const filing = matchMomsFiling(filings, period);
    return { period, filing, status: vatPeriodStatus(period, { filed: filing !== null, today }) };
  });

  // The period to show: the one asked for (if it is one the business can have
  // activity in), else the one that most needs attention.
  const asked = findVatPeriod(first(params.period), options);
  const requested = asked && asked.end >= activeFrom ? asked : null;
  const requestedFiling = requested ? matchMomsFiling(filings, requested) : null;
  const selected =
    (requested
      ? (rows.find((row) => row.period.key === requested.key) ?? {
          period: requested,
          filing: requestedFiling,
          status: vatPeriodStatus(requested, { filed: requestedFiling !== null, today })
        })
      : pickDefaultVatPeriod(rows, today)) ?? {
      // No period survives the filter only if the settings are inconsistent: show the current one.
      period: listVatPeriods(options).slice(-1)[0],
      filing: null,
      status: "upcoming" as VatPeriodStatus
    };
  const { period, filing, status } = selected;

  const requestedStep = first(params.step);
  const step: Step =
    requestedStep === "check" || requestedStep === "review" || requestedStep === "file"
      ? requestedStep
      : status === "filed"
        ? "file"
        : "check";

  const declaration = await buildMomsdeklaration({ businessId: business.id, from: period.start, to: period.end });
  const hasOrgNr = resolveOrgNr(business) !== null;
  const locked = locks.some((lock) => lock.periodStart <= period.start && lock.periodEnd >= period.end);

  // Checks that need more than the ledger: settings, the calendar and unpaid invoices.
  const pageChecks: VatPageCheck[] = [];
  if (!business.vatRegistered) pageChecks.push({ id: "notRegistered" });
  if (!hasOrgNr) pageChecks.push({ id: "noOrgNr" });
  if (status === "upcoming") pageChecks.push({ id: "periodOpen" });

  // Cash method: VAT on invoices still unpaid when the fiscal year ends belongs in the year's last period.
  const fiscalYearPeriods = rows.filter((row) => row.period.fiscalYear === period.fiscalYear);
  const lastOfFiscalYear = fiscalYearPeriods[fiscalYearPeriods.length - 1]?.period.key === period.key;
  if (status !== "filed" && lastOfFiscalYear && business.bookkeepingMethod !== "fakturametoden") {
    // Unpaid and part-paid invoices, and ROT/RUT reductions Skatteverket has not paid out yet.
    const unpaid = await loadUnreportedInvoiceVat(prisma, { businessId: business.id, end: period.end });
    if (unpaid.count > 0) {
      pageChecks.push({ id: "unpaidAtYearEnd", count: unpaid.count, amount: unpaid.amount });
    }
  }

  const filedFigures = filing ? filedBoxes(filing.payloadJson) : null;
  const shownBoxes = filedFigures ?? declaration.boxes;
  const net = shownBoxes["49"];
  const deadlineText = formatVatDate(period.deadline, locale);
  const days = daysUntil(period.deadline, today);
  const openBlockers = declaration.blockers.filter((b) => b.severity === "blocker").length;
  // Nothing booked, nothing waiting and not yet due: say so calmly instead of listing checks.
  const nothingYet =
    declaration.entryCount === 0 && declaration.blockers.length === 0 && (status === "upcoming" || status === "ready");

  const statusBadge = (value: VatPeriodStatus) =>
    value === "filed" ? "badge good" : value === "overdue" ? "badge warn" : "badge";

  const filedDate = (submittedAt: Date | null) =>
    submittedAt ? formatVatDate(new Date(`${swedishToday(submittedAt)}T00:00:00.000Z`), locale) : "";

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      {!business.vatRegistered && (
        <p className="note">
          {copy.notRegistered}{" "}
          <Link href="/settings" className="textLink">
            {copy.settings}
          </Link>
        </p>
      )}

      <article className="card" style={{ padding: "28px 26px" }}>
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="label">{vatPeriodLabel(period, locale)}</p>
            <span className={statusBadge(status)}>
              {status === "filed" ? copy.filedOn(filedDate(filing?.submittedAt ?? null)) : copy.statusLabel[status]}
            </span>
          </div>

          <div className="stack" style={{ gap: 2 }}>
            <p className="label">{nothingYet ? copy.nothingYet : net > 0 ? copy.pay : net < 0 ? copy.refund : copy.zero}</p>
            <p className="kpi" style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)" }}>
              {money(Math.abs(net))}
            </p>
            {nothingYet ? (
              <p className="note">{copy.nothingYetText}</p>
            ) : (
              status === "upcoming" && <p className="note">{copy.preliminary}</p>
            )}
          </div>

          {status !== "filed" && (
            <div className="stack" style={{ gap: 4 }}>
              <p style={{ margin: 0, fontWeight: 620 }}>
                {net > 0 ? copy.by(deadlineText) : copy.byRefund(deadlineText)}
                {status !== "upcoming" && <> {days >= 0 ? copy.daysLeft(days) : copy.daysLate(-days)}</>}
              </p>
              {status === "overdue" && <p className="error">{copy.lateText}</p>}
              <p className="note" style={{ maxWidth: "88ch" }}>
                {deadlineRuleText(period.deadlineRule, period.euTradeDeadline)}
                {period.deadlineMoved ? ` ${copy.moved}` : ""}{" "}
                <a href={SKV_LINKS.deadlines} target="_blank" rel="noreferrer" className="textLink">
                  {copy.source}
                </a>
              </p>
            </div>
          )}
        </div>
      </article>

      <article className="card" id="flow" style={{ padding: "24px 26px" }}>
        <div className="stack" style={{ gap: 24 }}>
          <nav className="row" aria-label={copy.title}>
            {(["check", "review", "file"] as const).map((name) => (
              <Link
                key={name}
                href={vatHref(period.key, name)}
                className={name === step ? "button" : "button secondary"}
                aria-current={name === step ? "step" : undefined}
              >
                {copy.steps[name]}
              </Link>
            ))}
          </nav>

          {step === "check" && (
            <VatCheckStep
              locale={locale}
              period={period}
              declaration={declaration}
              pageChecks={pageChecks}
              nothingYet={nothingYet}
            />
          )}
          {step === "review" && <VatReviewStep locale={locale} period={period} declaration={declaration} />}
          {step === "file" && (
            <VatFileStep
              locale={locale}
              period={period}
              status={status}
              boxes={declaration.boxes}
              hasOrgNr={hasOrgNr}
              openBlockers={openBlockers}
              filed={filing ? { submittedAt: filing.submittedAt, boxes: filedFigures, locked } : null}
            />
          )}
        </div>
      </article>

      <article className="card" id="periods">
        <h2>{copy.periodsHeading}</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          {copy.periodsIntro(copy.frequency[options.frequency])}{" "}
          <Link href="/settings" className="textLink">
            {copy.settings}
          </Link>
        </p>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.period}</th>
                <th>{copy.deadline}</th>
                <th>{copy.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period.key}>
                  <td>{vatPeriodLabel(row.period, locale)}</td>
                  <td>{formatVatDate(row.period.deadline, locale)}</td>
                  <td>
                    <span className={statusBadge(row.status)}>
                      {row.status === "filed"
                        ? copy.filedOn(filedDate(row.filing?.submittedAt ?? null))
                        : copy.statusLabel[row.status]}
                    </span>
                  </td>
                  <td>
                    {row.period.key === period.key ? (
                      <span className="note">{copy.current}</span>
                    ) : (
                      <Link href={vatHref(row.period.key, row.status === "filed" ? "file" : "check")}>{copy.open}</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
