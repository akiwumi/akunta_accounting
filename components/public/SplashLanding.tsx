"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import type { BlogPost } from "@/lib/content/blog";

type Props = {
  latestPosts: BlogPost[];
  locale: string;
  isLoggedIn?: boolean;
};

const FEATURES_EN = [
  { icon: "RC", title: "Receipt capture", description: "Upload or forward receipts by email. OCR extracts vendor, amount, VAT, and date automatically." },
  { icon: "IV", title: "Invoicing", description: "Create, send, and track invoices with automatic VAT calculation and PDF generation." },
  { icon: "BC", title: "Bank import", description: "Import your bank CSV and Akunta posts every row to the correct BAS account instantly." },
  { icon: "RP", title: "Reports & exports", description: "P&L, balance sheet, VAT summary, and NE-bilaga draft — all exportable to Excel." },
  { icon: "CK", title: "Swedish compliance", description: "Momsdeklaration, arbetsgivardeklaration, and period locks built for Skatteverket requirements." },
  { icon: "SL", title: "Payroll", description: "Calculate gross-to-net salary, employer contributions, and generate payslips for your employees." }
];

const FEATURES_SV = [
  { icon: "RC", title: "Kvittohantering", description: "Ladda upp eller vidarebefordra kvitton via e-post. OCR extraherar leverantör, belopp, moms och datum." },
  { icon: "IV", title: "Fakturering", description: "Skapa, skicka och följ upp fakturor med automatisk momsberäkning och PDF-generering." },
  { icon: "BC", title: "Bankimport", description: "Importera din bank-CSV och Akunta bokför varje rad på rätt BAS-konto direkt." },
  { icon: "RP", title: "Rapporter & export", description: "Resultaträkning, balansräkning, momssammanfattning och NE-bilaga — exporterbara till Excel." },
  { icon: "CK", title: "Svensk compliance", description: "Momsdeklaration, arbetsgivardeklaration och periodlås byggt för Skatteverkets krav." },
  { icon: "SL", title: "Löneadministration", description: "Beräkna brutto-till-netto lön, arbetsgivaravgifter och generera lönebesked." }
];

const TESTIMONIALS = [
  { quote: "I went from spending a weekend on quarterly VAT to about 20 minutes. The bank import alone is worth it.", author: "Sara L.", role: "Freelance designer, Stockholm" },
  { quote: "Finally a bookkeeping tool that understands Swedish sole trader rules without trying to be everything to everyone.", author: "Marcus H.", role: "IT consultant, Gothenburg" },
  { quote: "My accountant now receives a clean Excel export every year. She stopped asking me to fix things.", author: "Annika W.", role: "Copywriter, Malmö" },
  { quote: "Switching from a spreadsheet felt scary. Akunta made it obvious. I was up and running in an afternoon.", author: "Petra M.", role: "Therapist, Linköping" }
];

export function SplashLanding({ latestPosts, locale: initialLocale, isLoggedIn = false }: Props) {
  const [phase, setPhase] = useState<"splash" | "fade" | "landing">("splash");
  // Read locale from cookie client-side (cookie may differ from server initial)
  const [locale, setLocale] = useState(initialLocale);

  useEffect(() => {
    const cookie = document.cookie.split(";").find((c) => c.trim().startsWith("locale="));
    if (cookie) setLocale(cookie.split("=")[1]?.trim() ?? initialLocale);
  }, [initialLocale]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };

  useEffect(() => {
    // Skip splash if already seen this session (e.g. after a language change reload)
    if (sessionStorage.getItem("akunta_splash_shown")) {
      setPhase("landing");
      return;
    }
    // Logo fade-in takes ~500ms, then wait 3 seconds
    const fadeTimer = setTimeout(() => setPhase("fade"), 3500);
    const landTimer = setTimeout(() => {
      setPhase("landing");
      sessionStorage.setItem("akunta_splash_shown", "1");
    }, 4200);
    return () => { clearTimeout(fadeTimer); clearTimeout(landTimer); };
  }, []);

  const sv = locale === "sv";
  const features = sv ? FEATURES_SV : FEATURES_EN;

  const copy = sv
    ? {
        subtitle: "Bokföring & redovisning",
        heroTitle: "Bokföring för svenska egenföretagare — utan krångel.",
        heroSub: "Akunta hanterar kvitton, fakturor, bankimport, moms och löner på ett ställe. Svenska regler inbyggda.",
        startFree: "Kom igång gratis",
        signIn: "Logga in",
        dashboard: "Till översikten",
        logout: "Logga ut",
        featuresTitle: "Allt du behöver. Ingenting du inte behöver.",
        testimonialsTitle: "Vad egenföretagare säger",
        blogTitle: "Senast från bloggen",
        allArticles: "Alla artiklar",
        ctaTitle: "Redo att förenkla din bokföring?",
        ctaSub: "Kom igång på några minuter. Inget kreditkort krävs för gratisplanen.",
        ctaBtn: "Skapa konto",
        pricing: "Priser",
        help: "Hjälp",
        blog: "Blogg",
        resources: "Resurser",
        support: "Support",
        legal: "Byggd för svenska egenföretagare."
      }
    : {
        subtitle: "Bookkeeping Accounting",
        heroTitle: "Bookkeeping for Swedish sole traders — without the pain.",
        heroSub: "Akunta handles receipts, invoices, bank imports, VAT, and payroll in one place. Swedish rules built in. No accountant required for day-to-day books.",
        startFree: "Start free",
        signIn: "Sign in",
        dashboard: "Go to Dashboard",
        logout: "Log out",
        featuresTitle: "Everything you need. Nothing you don't.",
        testimonialsTitle: "What sole traders say",
        blogTitle: "Latest from the blog",
        allArticles: "All articles",
        ctaTitle: "Ready to simplify your bookkeeping?",
        ctaSub: "Get started in minutes. No credit card required for the free plan.",
        ctaBtn: "Create your account",
        pricing: "Pricing",
        help: "Help",
        blog: "Blog",
        resources: "Resources",
        support: "Support",
        legal: "Built for Swedish sole traders."
      };

  if (phase === "splash") {
    return (
      <div className="landingSplash">
        <div className="landingSplashInner">
          <Image src="/akunta_logo.png" alt="Akunta" width={610} height={614} className="landingSplashLogo" priority />
          <h1 className="splashTitle">Akunta</h1>
          <p className="splashSubtitle">{copy.subtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`publicPage${phase === "fade" ? " landingFadeIn" : ""}`}>
      {/* Nav */}
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={32} height={32} className="publicNavLogo" />
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/pricing">{copy.pricing}</Link>
            <Link href="/help">{copy.help}</Link>
            <Link href="/blog">{copy.blog}</Link>
            <Link href="/support">{copy.support}</Link>
          </nav>
          <div className="publicNavRight">
            <LanguageSwitcher current={locale} />
            {isLoggedIn ? (
              <>
                <Link href="/dashboard" className="button publicNavCta">{copy.dashboard}</Link>
                <button type="button" className="button tertiary" onClick={handleLogout}>{copy.logout}</button>
              </>
            ) : (
              <Link href="/login" className="button publicNavCta">{copy.signIn}</Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="publicHero">
        <div className="publicHeroContent">
          <h1 className="publicHeroTitle">{copy.heroTitle}</h1>
          <p className="publicHeroSubtitle">{copy.heroSub}</p>
          <div className="publicHeroCtas">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard" className="button publicHeroCtaPrimary">{copy.dashboard}</Link>
                <button type="button" className="button tertiary" onClick={handleLogout}>{copy.logout}</button>
              </>
            ) : (
              <>
                <Link href="/register" className="button publicHeroCtaPrimary">{copy.startFree}</Link>
                <Link href="/login" className="button tertiary">{copy.signIn}</Link>
              </>
            )}
          </div>
        </div>
        <div className="publicHeroImage" aria-hidden>
          <Image src="/akunta_logo.png" alt="" width={200} height={200} className="publicHeroLogo" priority />
        </div>
      </section>

      {/* Features */}
      <section className="publicSection" id="features">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">{copy.featuresTitle}</h2>
          <div className="publicFeaturesGrid">
            {features.map((f) => (
              <article key={f.icon} className="publicFeatureCard">
                <span className="publicFeatureIcon" aria-hidden>{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
              </article>
            ))}
          </div>
          {/* CTA inside features section */}
          {!isLoggedIn && (
            <div className="publicSectionAction">
              <Link href="/register" className="button publicHeroCtaPrimary">{copy.startFree}</Link>
              <Link href="/pricing" className="button tertiary">{copy.pricing}</Link>
            </div>
          )}
        </div>
      </section>

      {/* Testimonials */}
      <section className="publicSection publicSectionAlt" id="testimonials">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">{copy.testimonialsTitle}</h2>
          <div className="publicTestimonialsGrid">
            {TESTIMONIALS.map((t) => (
              <blockquote key={t.author} className="publicTestimonialCard">
                <p className="publicTestimonialQuote">&ldquo;{t.quote}&rdquo;</p>
                <footer>
                  <strong>{t.author}</strong>
                  <span className="publicTestimonialRole">{t.role}</span>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* Blog */}
      <section className="publicSection" id="blog">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">{copy.blogTitle}</h2>
          <div className="publicBlogGrid">
            {latestPosts.map((post) => (
              <article key={post.slug} className="publicBlogCard">
                <time className="publicBlogDate" dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString(sv ? "sv-SE" : "en-GB", { year: "numeric", month: "long", day: "numeric" })}
                </time>
                <h3><Link href={`/blog/${post.slug}`}>{post.title}</Link></h3>
                <p className="publicBlogExcerpt">{post.excerpt}</p>
                <Link href={`/blog/${post.slug}`} className="publicBlogReadMore">
                  {sv ? "Läs mer →" : "Read more →"}
                </Link>
              </article>
            ))}
          </div>
          <div className="publicSectionAction">
            <Link href="/blog" className="button tertiary">{copy.allArticles}</Link>
          </div>
        </div>
      </section>

      {/* CTA banner — only shown to logged-out visitors */}
      {!isLoggedIn && (
        <section className="publicCtaBanner">
          <div className="publicCtaBannerInner">
            <h2>{copy.ctaTitle}</h2>
            <p>{copy.ctaSub}</p>
            <Link href="/register" className="button publicHeroCtaPrimary">{copy.ctaBtn}</Link>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="publicFooter">
        <div className="publicFooterInner">
          <div className="publicFooterBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={24} height={24} />
            <span>Akunta</span>
          </div>
          <nav className="publicFooterLinks">
            <Link href="/pricing">{copy.pricing}</Link>
            <Link href="/help">{copy.help}</Link>
            <Link href="/blog">{copy.blog}</Link>
            <Link href="/resources">{copy.resources}</Link>
            <Link href="/support">{copy.support}</Link>
            <Link href="/privacy">{sv ? "Integritetspolicy" : "Privacy"}</Link>
            <Link href="/terms">{sv ? "Villkor" : "Terms"}</Link>
            {isLoggedIn
              ? <Link href="/dashboard">{copy.dashboard}</Link>
              : <Link href="/login">{copy.signIn}</Link>}
          </nav>
          <p className="publicFooterLegal">&copy; {new Date().getFullYear()} Akunta. {copy.legal}</p>
        </div>
      </footer>
    </div>
  );
}
