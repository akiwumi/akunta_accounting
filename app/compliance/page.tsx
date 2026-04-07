export const dynamic = "force-dynamic";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { getSkattekontoBalanceSEK } from "@/lib/integrations/skatteverket/skattekonto";

type CheckItem = {
  id: string;
  category: string;
  label: string;
  detail: string;
  deadline?: string;
  status: "ok" | "warn" | "info";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null | undefined, sv: boolean): string {
  if (!d) return "–";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString(sv ? "sv-SE" : "en-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function saldoLabel(sek: number, sv: boolean): string {
  const fmt = (n: number) =>
    Math.abs(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sek > 0) return sv ? `+${fmt(sek)} kr (överskott)` : `+${fmt(sek)} SEK (credit)`;
  if (sek < 0) return sv ? `${fmt(sek)} kr (skuld)` : `${fmt(sek)} SEK (owed)`;
  return sv ? "0,00 kr (i balans)" : "0.00 SEK (balanced)";
}

function filingStatusClass(status: string): string {
  if (status === "ACCEPTED") return "complianceFilingAccepted";
  if (status === "REJECTED") return "complianceFilingRejected";
  if (status === "SUBMITTED") return "complianceFilingSubmitted";
  return "complianceFilingDraft";
}

function filingStatusLabel(status: string, sv: boolean): string {
  const map: Record<string, [string, string]> = {
    DRAFT:     ["Utkast",   "Draft"],
    SUBMITTED: ["Inlämnad", "Submitted"],
    ACCEPTED:  ["Godkänd",  "Accepted"],
    REJECTED:  ["Avvisad",  "Rejected"],
  };
  const [s, e] = map[status] ?? [status, status];
  return sv ? s : e;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CompliancePage() {
  const locale = getRequestLocale();
  const sv = locale === "sv";
  const now = new Date();
  const taxYear = now.getFullYear() - 1;
  const filingYear = now.getFullYear();

  const business = await ensureBusiness();
  const fresh = await prisma.business.findUnique({
    where: { id: business.id },
    include: { taxConfig: true },
  });

  // ── Live DB data ───────────────────────────────────────────────────────────
  const [
    vatFilings,
    taxEvents,
    periodLocks,
    unmatchedBankLines,
    openInvoices,
    receiptsNeedReview,
    transactionCount,
    receiptCount,
    invoiceCount,
    assetCount,
    mileageCount,
    periodisationCount,
  ] = await Promise.all([
    prisma.filing.findMany({
      where: { businessId: business.id, filingType: "MOMS" },
      orderBy: { periodEnd: "desc" },
      take: 8,
    }),
    prisma.taxEvent.findMany({
      where: { businessId: business.id },
      orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }],
      take: 10,
    }),
    prisma.periodLock.findMany({
      where: { businessId: business.id },
      orderBy: { periodStart: "desc" },
    }),
    prisma.bankStatementLine.count({ where: { businessId: business.id, status: "UNMATCHED" } }),
    prisma.invoice.count({ where: { businessId: business.id, status: "UNPAID" } }),
    prisma.receipt.count({ where: { businessId: business.id, needsReview: true } }),
    prisma.transaction.count({
      where: {
        businessId: business.id,
        txnDate: { gte: new Date(`${taxYear}-01-01`), lte: new Date(`${taxYear}-12-31`) },
      },
    }),
    prisma.receipt.count({ where: { businessId: business.id } }),
    prisma.invoice.count({ where: { businessId: business.id } }),
    prisma.fixedAsset.count({ where: { businessId: business.id } }).catch(() => 0),
    prisma.mileageEntry
      .count({
        where: {
          businessId: business.id,
          tripDate: { gte: new Date(`${taxYear}-01-01`), lte: new Date(`${taxYear}-12-31`) },
        },
      })
      .catch(() => 0),
    prisma.periodisationEntry
      .count({ where: { businessId: business.id, taxYear } })
      .catch(() => 0),
  ]);

  // ── Optional Skattekonto ───────────────────────────────────────────────────
  const orgNumber = fresh?.personnummer ?? fresh?.vatNumber ?? fresh?.skvActorId ?? null;
  let skattekontoSaldo: number | null = null;
  let skattekontoError: string | null = null;
  if (orgNumber) {
    try {
      skattekontoSaldo = await getSkattekontoBalanceSEK(orgNumber);
    } catch (err) {
      skattekontoError =
        err instanceof Error
          ? err.message
          : sv ? "Kunde inte hämta skattekonto." : "Could not fetch skattekonto.";
    }
  }

  // ── Checklist ──────────────────────────────────────────────────────────────
  const b = fresh as typeof fresh & {
    sniCode?: string | null;
    vatNumber?: string | null;
    fSkattRegistered?: boolean;
    personnummer?: string | null;
  };

  const hasTaxConfig     = Boolean(fresh?.taxConfig);
  const hasSni           = Boolean(b?.sniCode);
  const hasVatNumber     = Boolean(b?.vatNumber);
  const hasFSkatt        = Boolean(b?.fSkattRegistered);
  const hasPersonnummer  = Boolean(b?.personnummer);
  const vatRegistered    = fresh?.vatRegistered ?? false;
  const vatFrequency     = fresh?.vatFrequency ?? "yearly";

  const vatDeadline =
    vatFrequency === "yearly"
      ? sv ? `12 maj ${filingYear}` : `12 May ${filingYear}`
      : vatFrequency === "quarterly"
      ? sv ? "12:e i andra månaden efter kvartal" : "12th of 2nd month after quarter"
      : sv ? "26:e i månaden efter perioden" : "26th of month following period";

  const checks: CheckItem[] = [
    {
      id: "fskatt",
      category: sv ? "Registrering" : "Registration",
      label: sv ? "Godkänd för F-skatt" : "F-tax approval (F-skatt)",
      detail: sv
        ? "Alla enskilda firmor behöver F-skatt för att fakturera utan källskatteavdrag."
        : "All sole traders need F-tax approval to invoice without tax deduction at source.",
      status: hasFSkatt ? "ok" : "warn",
    },
    {
      id: "sni",
      category: sv ? "Registrering" : "Registration",
      label: sv ? "SNI-kod registrerad" : "SNI industry code registered",
      detail: sv
        ? `SNI-kod: ${b?.sniCode ?? "–"}. Registrera på verksamt.se.`
        : `SNI code: ${b?.sniCode ?? "–"}. Register at verksamt.se.`,
      status: hasSni ? "ok" : "warn",
    },
    {
      id: "vatnum",
      category: sv ? "Registrering" : "Registration",
      label: sv ? "Momsregistreringsnummer" : "VAT registration number",
      detail: sv
        ? `Momsregistreringsnummer: ${b?.vatNumber ?? "–"}. Format SE + personnummer + 01.`
        : `VAT number: ${b?.vatNumber ?? "–"}. Format SE + personal number + 01.`,
      status: vatRegistered ? (hasVatNumber ? "ok" : "warn") : "info",
    },
    {
      id: "personnummer",
      category: sv ? "Registrering" : "Registration",
      label: sv ? "Personnummer registrerat i appen" : "Personal identity number in app",
      detail: sv
        ? "Personnumret behövs för Inkomstdeklaration 1."
        : "Required for Inkomstdeklaration 1.",
      status: hasPersonnummer ? "ok" : "warn",
    },
    {
      id: "bookkeeping",
      category: sv ? "Bokföring" : "Bookkeeping",
      label: sv ? "Löpande bokföring" : "Current bookkeeping",
      detail: sv
        ? `${transactionCount} transaktioner bokförda för ${taxYear}.`
        : `${transactionCount} transactions posted for ${taxYear}.`,
      status: transactionCount > 0 ? "ok" : "warn",
    },
    {
      id: "receipts",
      category: sv ? "Bokföring" : "Bookkeeping",
      label: sv ? "Kvitton lagrade (7 år)" : "Receipts stored (7-year retention)",
      detail: sv
        ? `${receiptCount} kvitton lagrade. Alla underlag ska bevaras i minst 7 år.`
        : `${receiptCount} receipts stored. Retain all documents for at least 7 years.`,
      status: receiptCount > 0 ? "ok" : "warn",
    },
    {
      id: "invoices",
      category: sv ? "Bokföring" : "Bookkeeping",
      label: sv ? "Fakturor utfärdade" : "Invoices issued",
      detail: sv
        ? `${invoiceCount} fakturor. Kontrollera att alla innehåller momsnummer och F-skatt.`
        : `${invoiceCount} invoices. Verify all include VAT number and F-tax status.`,
      status: invoiceCount > 0 ? "ok" : "info",
    },
    {
      id: "assets",
      category: sv ? "Bokföring" : "Bookkeeping",
      label: sv ? "Inventarieregister" : "Fixed asset register",
      detail: sv
        ? `${assetCount} tillgångar. Inventarier (>25 000 kr) ska aktiveras och skrivas av.`
        : `${assetCount} assets. Equipment (> SEK 25,000) must be capitalised and depreciated.`,
      status: assetCount > 0 ? "ok" : "info",
    },
    {
      id: "mileage",
      category: sv ? "Avdrag" : "Deductions",
      label: sv ? "Körjournal (milersättning)" : "Mileage log",
      detail: sv
        ? `${mileageCount} resor loggade för ${taxYear}. Schablonersättning: 1,85 kr/km.`
        : `${mileageCount} trips logged for ${taxYear}. Standard rate: SEK 1.85/km.`,
      status: mileageCount > 0 ? "ok" : "info",
    },
    {
      id: "periodisering",
      category: sv ? "Skatteplanering" : "Tax Planning",
      label: sv ? "Periodiseringsfond / Expansionsfond" : "Tax allocation reserve",
      detail: sv
        ? `${periodisationCount} poster för ${taxYear}. Avsättning upp till 30 % av överskott.`
        : `${periodisationCount} entries for ${taxYear}. Allocate up to 30% of surplus to reduce tax.`,
      status: periodisationCount > 0 ? "ok" : "info",
    },
    {
      id: "taxconfig",
      category: sv ? "Skatteprognos" : "Tax Estimate",
      label: sv ? "Skattekonfiguration" : "Tax configuration",
      detail: sv
        ? "Kommunal skattesats, egenavgifter och allmänt avdrag konfigurerade."
        : "Municipal tax rate, social contributions and general deduction configured.",
      status: hasTaxConfig ? "ok" : "warn",
    },
    {
      id: "vat_return",
      category: sv ? "Moms" : "VAT",
      label: sv ? "Momsdeklaration" : "VAT return",
      detail: sv
        ? `Redovisningsperiod: ${vatFrequency === "yearly" ? "årsvis" : vatFrequency === "quarterly" ? "kvartalsvis" : "månadsvis"}. Senast: ${vatDeadline}.`
        : `VAT frequency: ${vatFrequency}. Deadline: ${vatDeadline}.`,
      deadline: vatDeadline,
      status: "info",
    },
    {
      id: "inkomstdekl",
      category: sv ? "Deklarationsfrister" : "Filing Deadlines",
      label: sv ? "Inkomstdeklaration 1 + NE-bilaga" : "Inkomstdeklaration 1 + NE-bilaga",
      detail: sv
        ? `Lämna in Inkomstdeklaration 1 med NE-bilagan. Senast 4 maj ${filingYear} (pappers) / 2 maj ${filingYear} (e-tjänst).`
        : `File Inkomstdeklaration 1 with NE-bilaga. Deadline: 4 May ${filingYear} (paper) / 2 May ${filingYear} (e-service).`,
      deadline: sv ? `4 maj ${filingYear}` : `4 May ${filingYear}`,
      status: "info",
    },
    {
      id: "egenavgifter",
      category: sv ? "Skattebetalning" : "Tax Payments",
      label: sv ? "Egenavgifter (~28,97 %)" : "Self-employment contributions (~28.97%)",
      detail: sv
        ? "Egenavgifter beräknas på nettoinkomsten. Avdrag medges med 25 % av avgifterna."
        : "Self-employment contributions calculated on net income. 25% deduction allowed.",
      status: hasTaxConfig ? "ok" : "warn",
    },
  ];

  const checkItemClass = (s: "ok" | "warn" | "info") =>
    `complianceCheckItem complianceCheckItem${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  const badgeClass = (s: "ok" | "warn" | "info") =>
    `complianceCheckBadge complianceCheckBadge${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  const badgeLabel = (s: "ok" | "warn" | "info") =>
    s === "ok" ? (sv ? "Klart" : "Done") : s === "warn" ? (sv ? "Saknas" : "Missing") : (sv ? "Notera" : "Note");

  const categories = [...new Set(checks.map((c) => c.category))];
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const okCount   = checks.filter((c) => c.status === "ok").length;

  return (
    <section className="page">
      <h1 className="title">{sv ? "Efterlevnad & skatteöversikt" : "Compliance & Tax Overview"}</h1>
      <p className="subtitle">
        {sv
          ? `Skatteår ${taxYear} – deklaration ${filingYear}. Livestatus och kravlista för enskild firma.`
          : `Tax year ${taxYear} – filing year ${filingYear}. Live status and checklist for Swedish sole traders.`}
      </p>

      {/* Alert strip */}
      {(unmatchedBankLines > 0 || receiptsNeedReview > 0 || openInvoices > 0) && (
        <div className="complianceAlertStrip">
          {unmatchedBankLines > 0 && (
            <span className="complianceBadgeWarn">
              {unmatchedBankLines} {sv ? "omatchade bankrader" : "unmatched bank lines"}
            </span>
          )}
          {receiptsNeedReview > 0 && (
            <span className="complianceBadgeWarn">
              {receiptsNeedReview} {sv ? "kvitton kräver granskning" : "receipts need review"}
            </span>
          )}
          {openInvoices > 0 && (
            <span className="complianceBadgeInfo">
              {openInvoices}{" "}
              {openInvoices === 1
                ? (sv ? "obetald faktura" : "unpaid invoice")
                : (sv ? "obetalda fakturor" : "unpaid invoices")}
            </span>
          )}
        </div>
      )}

      {/* KPI row */}
      <div className="grid">
        <article className="card">
          <p className="label">{sv ? "Klara krav" : "Complete"}</p>
          <p className={`kpi complianceSaldoOk`}>{okCount} / {checks.length}</p>
        </article>
        <article className="card">
          <p className="label">{sv ? "Saknas" : "Missing"}</p>
          <p className={`kpi ${warnCount > 0 ? "complianceSaldoBad" : "complianceSaldoOk"}`}>
            {warnCount}
          </p>
        </article>
        <article className="card">
          <p className="label">{sv ? "Låsta perioder" : "Locked periods"}</p>
          <p className="kpi">{periodLocks.length}</p>
        </article>
      </div>

      {/* Skattekonto */}
      <article className="card">
        <h2>{sv ? "Skattekonto" : "Tax Account (Skattekonto)"}</h2>
        {!orgNumber ? (
          <p className="note">
            {sv
              ? "Ange personnummer eller organisationsnummer under Inställningar för att se skattekontosaldo."
              : "Add your personal number or organisation number in Settings to see the tax account balance."}
          </p>
        ) : skattekontoError ? (
          <p className={`note complianceSaldoBad`}>{skattekontoError}</p>
        ) : skattekontoSaldo !== null ? (
          <p className={`kpi ${skattekontoSaldo >= 0 ? "complianceSaldoOk" : "complianceSaldoBad"}`}>
            {saldoLabel(skattekontoSaldo, sv)}
          </p>
        ) : null}
      </article>

      {/* Kundhändelser */}
      {taxEvents.length > 0 && (
        <article className="card">
          <h2>{sv ? "Kommande händelser (Kundhändelser)" : "Upcoming Events (Kundhändelser)"}</h2>
          <div className="stack">
            {taxEvents.map((e) => (
              <div key={e.id} className="complianceEventRow">
                <div className="stack">
                  <strong className="complianceEventRowTitle">{e.title}</strong>
                  {e.detail && <p className="note">{e.detail}</p>}
                </div>
                {e.eventDate && (
                  <span className="complianceEventDate">{formatDate(e.eventDate, sv)}</span>
                )}
              </div>
            ))}
          </div>
        </article>
      )}

      {/* VAT filing history */}
      {vatFilings.length > 0 && (
        <article className="card">
          <h2>{sv ? "Momsdeklarationer" : "VAT Filings"}</h2>
          <div className="stack">
            {vatFilings.map((f) => (
              <div key={f.id} className="complianceFilingRow">
                <span>
                  {formatDate(f.periodStart, sv)} – {formatDate(f.periodEnd, sv)}
                </span>
                <span className={`complianceFilingStatus ${filingStatusClass(f.status)}`}>
                  {filingStatusLabel(f.status, sv)}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Locked periods */}
      {periodLocks.length > 0 && (
        <article className="card">
          <h2>{sv ? "Låsta räkenskapsperioder" : "Locked Accounting Periods"}</h2>
          <div className="stack">
            {periodLocks.map((lock) => (
              <div key={lock.id} className="complianceLockRow">
                <span>
                  {formatDate(lock.periodStart, sv)} – {formatDate(lock.periodEnd, sv)}
                </span>
                <span className="complianceLockRowMeta">
                  {sv ? "Låst" : "Locked"} {formatDate(lock.lockedAt, sv)}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Static checklist */}
      <h2 className="complianceChecklistSectionTitle">
        {sv ? "Kravlista" : "Compliance Checklist"}
      </h2>
      <p className="note">
        {sv
          ? "Informativ kravlista. Kontrollera alltid med Skatteverket inför deklaration."
          : "Informational checklist. Always verify with Skatteverket before filing."}
      </p>

      {categories.map((category) => (
        <article className="card" key={category}>
          <h2>{category}</h2>
          <div className="stack">
            {checks
              .filter((c) => c.category === category)
              .map((check) => (
                <div key={check.id} className={checkItemClass(check.status)}>
                  <span className={badgeClass(check.status)}>{badgeLabel(check.status)}</span>
                  <div className="complianceCheckBody">
                    <strong className="complianceCheckLabel">{check.label}</strong>
                    <p className="note">{check.detail}</p>
                    {check.deadline && (
                      <p className={`note complianceCheckDeadline`}>
                        {sv ? "Senast" : "Deadline"}: {check.deadline}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </article>
      ))}
    </section>
  );
}
