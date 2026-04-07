"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

const FEATURES = [
  "Receipt capture with OCR",
  "Unlimited invoices & PDF export",
  "Bank CSV import & reconciliation",
  "P&L, balance sheet, VAT report",
  "NE-bilaga & Inkomstdeklaration 1 draft",
  "Momsdeklaration filing",
  "Payroll & arbetsgivardeklaration",
  "PEPPOL e-invoice delivery",
  "Skatteverket integration",
  "Periodiseringsfond & expansionsfond",
  "Year-end close & opening balances",
  "Audit trail",
  "Export to Excel",
  "BankID login (coming soon)"
];

const PLANS = [
  {
    id: "akunta",
    name: "Akunta",
    nameSv: "Akunta",
    tagline: "Everything included. One simple price.",
    taglineSv: "Allt ingår. Ett enkelt pris.",
    monthlyPrice: 125,
    annualPrice: 1250, // 2 months free
    currency: "SEK",
    highlighted: true
  }
];

export default function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  // Simple client-side locale from cookie
  const isSv =
    typeof document !== "undefined" && document.cookie.includes("locale=sv");

  const copy = isSv
    ? {
        nav: "Hem",
        badge: "Spara 2 månader",
        title: "Enkel prissättning",
        subtitle:
          "Alla funktioner ingår i alla planer. Välj den faktureringsperiod som passar dig.",
        monthly: "Månadsvis",
        annual: "Årsvis",
        perMonth: "/mån",
        perYear: "/år",
        billedAnnually: "Faktureras årsvis",
        billedMonthly: "Faktureras månadsvis",
        included: "Allt ingår",
        startFree: "Kom igång",
        faq: "Vanliga frågor",
        faqItems: [
          {
            q: "Kan jag byta plan?",
            a: "Ja, du kan uppgradera eller nedgradera när som helst. Fakturering justeras proportionellt."
          },
          {
            q: "Finns det en gratis provperiod?",
            a: "Ja, alla betalplaner har 7 dagars gratis provperiod. Du kan avbryta när som helst innan provperioden löper ut och debiteras då inte."
          },
          {
            q: "Finns det bindningstid?",
            a: "Nej. Månadsprenumerationer förnyas varje månad. Årsplaner löper ett år och förnyas sedan automatiskt."
          },
          {
            q: "Är moms inkluderat?",
            a: "Nej. Priserna är exklusive moms (25%). Moms tillkommer vid betalning."
          },
          {
            q: "Vad händer om jag vill avsluta?",
            a: "Du kan avsluta när som helst i dina kontoinställningar. Du behåller åtkomst till din data ut innevarande period."
          },
          {
            q: "Finns det återbetalningar?",
            a: "Nej, vi erbjuder inga återbetalningar. Men vi gör alltid vårt bästa för att lösa eventuella problem som uppstår."
          }
        ]
      }
    : {
        nav: "Home",
        badge: "Save 2 months",
        title: "Simple pricing",
        subtitle:
          "Every feature included in every plan. Choose the billing period that works for you.",
        monthly: "Monthly",
        annual: "Annual",
        perMonth: "/mo",
        perYear: "/yr",
        billedAnnually: "Billed annually",
        billedMonthly: "Billed monthly",
        included: "Everything included",
        startFree: "Get started",
        faq: "Frequently asked questions",
        faqItems: [
          {
            q: "Can I switch plans?",
            a: "Yes, you can upgrade or downgrade at any time. Billing is adjusted pro-rata."
          },
          {
            q: "Is there a free trial?",
            a: "Yes, all paid plans include a 7-day free trial. You can cancel any time before the trial ends and you will not be charged."
          },
          {
            q: "Is there a minimum commitment?",
            a: "No. Monthly plans renew each month. Annual plans run for one year then auto-renew."
          },
          {
            q: "Is VAT included?",
            a: "No. Prices are excluding Swedish VAT (25%), which is added at checkout."
          },
          {
            q: "What happens if I cancel?",
            a: "Cancel any time in your account settings. You keep access until the end of your billing period."
          },
          {
            q: "Are there refunds?",
            a: "No, we do not offer refunds. However, we will always do our best to resolve any problems that occur."
          }
        ]
      };

  return (
    <div className="publicPage">
      {/* Nav */}
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={32} height={32} className="publicNavLogo" />
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/">{copy.nav}</Link>
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      {/* Pricing hero */}
      <section className="pricingHero">
        <h1 className="pricingTitle">{copy.title}</h1>
        <p className="pricingSubtitle">{copy.subtitle}</p>

        {/* Billing toggle */}
        <div className="pricingToggle" role="group" aria-label="Billing period">
          <button
            className={`pricingToggleBtn${billing === "monthly" ? " active" : ""}`}
            onClick={() => setBilling("monthly")}
          >
            {copy.monthly}
          </button>
          <button
            className={`pricingToggleBtn${billing === "annual" ? " active" : ""}`}
            onClick={() => setBilling("annual")}
          >
            {copy.annual}
            <span className="pricingAnnualBadge">{copy.badge}</span>
          </button>
        </div>
      </section>

      {/* Cards */}
      <section className="pricingCards">
        {PLANS.map((plan) => {
          const price = billing === "monthly" ? plan.monthlyPrice : plan.annualPrice;
          const perLabel = billing === "monthly" ? copy.perMonth : copy.perYear;
          const billingNote =
            billing === "annual" ? copy.billedAnnually : copy.billedMonthly;

          return (
            <article
              key={plan.id}
              className={`pricingCard${plan.highlighted ? " pricingCardHighlighted" : ""}`}
            >
              {plan.highlighted && (
                <div className="pricingCardBadge">Most popular</div>
              )}
              <h2 className="pricingCardName">{isSv ? plan.nameSv : plan.name}</h2>
              <p className="pricingCardTagline">{isSv ? plan.taglineSv : plan.tagline}</p>

              <div className="pricingCardPrice">
                <span className="pricingCurrency">{plan.currency}</span>
                <span className="pricingAmount">{price.toLocaleString("sv-SE")}</span>
                <span className="pricingPer">{perLabel}</span>
              </div>
              <p className="pricingBillingNote">{billingNote}</p>
              {billing === "annual" && (
                <p className="pricingAnnualSaving">
                  {isSv
                    ? `Spara ${(plan.monthlyPrice * 2).toLocaleString("sv-SE")} SEK/år`
                    : `Save ${(plan.monthlyPrice * 2).toLocaleString("sv-SE")} SEK/year`}
                </p>
              )}

              <Link href="/register" className={`button pricingCta${plan.highlighted ? " pricingCtaHighlighted" : ""}`}>
                {copy.startFree}
              </Link>

              <div className="pricingFeatureList">
                <p className="pricingFeaturesHeading">{copy.included}</p>
                <ul>
                  {FEATURES.map((f) => (
                    <li key={f} className="pricingFeatureItem">
                      <span className="pricingFeatureCheck" aria-hidden>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </section>

      {/* FAQ */}
      <section className="publicSection" id="faq">
        <div className="publicSectionInner pricingFaq">
          <h2 className="publicSectionTitle">{copy.faq}</h2>
          <div className="pricingFaqGrid">
            {copy.faqItems.map((item) => (
              <div key={item.q} className="pricingFaqItem">
                <h3 className="pricingFaqQ">{item.q}</h3>
                <p className="pricingFaqA">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="publicCtaBanner">
        <div className="publicCtaBannerInner">
          <h2>
            {isSv ? "Redo att förenkla din bokföring?" : "Ready to simplify your bookkeeping?"}
          </h2>
          <p>
            {isSv
              ? "Kom igång på några minuter. Inget kreditkort krävs."
              : "Get started in minutes. No credit card required."}
          </p>
          <Link href="/register" className="button publicHeroCtaPrimary">
            {isSv ? "Skapa konto" : "Create your account"}
          </Link>
        </div>
      </section>

      <footer className="publicFooter">
        <div className="publicFooterInner">
          <div className="publicFooterBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={24} height={24} />
            <span>Akunta</span>
          </div>
          <nav className="publicFooterLinks">
            <Link href="/">{copy.nav}</Link>
            <Link href="/pricing">{isSv ? "Priser" : "Pricing"}</Link>
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/login">Sign in</Link>
          </nav>
          <p className="publicFooterLegal">
            &copy; {new Date().getFullYear()} Akunta. Built for Swedish sole traders.
          </p>
        </div>
      </footer>
    </div>
  );
}
