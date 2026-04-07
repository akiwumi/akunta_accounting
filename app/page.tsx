import Image from "next/image";
import Link from "next/link";

import { getLatestBlogPosts } from "@/lib/content/blog";

const features = [
  {
    icon: "RC",
    title: "Receipt capture",
    description: "Upload or forward receipts by email. OCR extracts vendor, amount, VAT, and date automatically."
  },
  {
    icon: "IV",
    title: "Invoicing",
    description: "Create, send, and track invoices with automatic VAT calculation and PDF generation."
  },
  {
    icon: "BC",
    title: "Bank import",
    description: "Import your bank CSV and Akunta posts every row to the correct BAS account instantly."
  },
  {
    icon: "RP",
    title: "Reports & exports",
    description: "P&L, balance sheet, VAT summary, and NE-bilaga draft — all exportable to Excel."
  },
  {
    icon: "CK",
    title: "Swedish compliance",
    description: "Momsdeklaration, arbetsgivardeklaration, and period locks built for Skatteverket requirements."
  },
  {
    icon: "SL",
    title: "Payroll",
    description: "Calculate gross-to-net salary, employer contributions, and generate payslips for your employees."
  }
];

const testimonials = [
  {
    quote: "I went from spending a weekend on quarterly VAT to about 20 minutes. The bank import alone is worth it.",
    author: "Sara L.",
    role: "Freelance designer, Stockholm"
  },
  {
    quote: "Finally a bookkeeping tool that understands Swedish sole trader rules without trying to be everything to everyone.",
    author: "Marcus H.",
    role: "IT consultant, Gothenburg"
  },
  {
    quote: "My accountant now receives a clean Excel export every year. She stopped asking me to fix things.",
    author: "Annika W.",
    role: "Copywriter, Malmö"
  },
  {
    quote: "The OCR on receipts isn't perfect but it's accurate enough that I only ever correct one or two fields.",
    author: "Johan R.",
    role: "Photographer, Uppsala"
  },
  {
    quote: "Switching from a spreadsheet felt scary. Akunta made it obvious. I was up and running in an afternoon.",
    author: "Petra M.",
    role: "Therapist, Linköping"
  }
];

export default function LandingPage() {
  const latestPosts = getLatestBlogPosts(4);

  return (
    <div className="publicPage">
      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={32} height={32} className="publicNavLogo" />
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="publicHero">
        <div className="publicHeroContent">
          <h1 className="publicHeroTitle">
            Bookkeeping for Swedish sole traders — without the pain.
          </h1>
          <p className="publicHeroSubtitle">
            Akunta handles receipts, invoices, bank imports, VAT, and payroll in one place.
            Swedish rules built in. No accountant required for day-to-day books.
          </p>
          <div className="publicHeroCtas">
            <Link href="/register" className="button publicHeroCtaPrimary">
              Start free
            </Link>
            <Link href="/login" className="button tertiary">
              Sign in
            </Link>
          </div>
        </div>
        <div className="publicHeroImage" aria-hidden>
          <Image
            src="/akunta_logo.png"
            alt=""
            width={200}
            height={200}
            className="publicHeroLogo"
            priority
          />
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section className="publicSection" id="features">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">Everything you need. Nothing you don&apos;t.</h2>
          <div className="publicFeaturesGrid">
            {features.map((f) => (
              <article key={f.icon} className="publicFeatureCard">
                <span className="publicFeatureIcon" aria-hidden>{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ───────────────────────────────────────────────── */}
      <section className="publicSection publicSectionAlt" id="testimonials">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">What sole traders say</h2>
          <div className="publicTestimonialsGrid">
            {testimonials.map((t) => (
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

      {/* ── Latest blog posts ───────────────────────────────────────────── */}
      <section className="publicSection" id="blog">
        <div className="publicSectionInner">
          <h2 className="publicSectionTitle">Latest from the blog</h2>
          <div className="publicBlogGrid">
            {latestPosts.map((post) => (
              <article key={post.slug} className="publicBlogCard">
                <time className="publicBlogDate" dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString("en-GB", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                  })}
                </time>
                <h3>
                  <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                </h3>
                <p className="publicBlogExcerpt">{post.excerpt}</p>
                <Link href={`/blog/${post.slug}`} className="publicBlogReadMore">
                  Read more →
                </Link>
              </article>
            ))}
          </div>
          <div className="publicSectionAction">
            <Link href="/blog" className="button tertiary">
              All articles
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA footer ─────────────────────────────────────────────────── */}
      <section className="publicCtaBanner">
        <div className="publicCtaBannerInner">
          <h2>Ready to simplify your bookkeeping?</h2>
          <p>Get started in minutes. No credit card required for the free plan.</p>
          <Link href="/register" className="button publicHeroCtaPrimary">
            Create your account
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="publicFooter">
        <div className="publicFooterInner">
          <div className="publicFooterBrand">
            <Image src="/akunta_logo.png" alt="Akunta" width={24} height={24} />
            <span>Akunta</span>
          </div>
          <nav className="publicFooterLinks">
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
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
