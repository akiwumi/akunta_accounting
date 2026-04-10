import Link from "next/link";

import { getHelpArticlesByCategory } from "@/lib/content/help";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Help Centre",
  description: "Step-by-step guides for using Akunta receipts, invoicing, VAT reports, payroll, and exports.",
  path: "/help"
});

export default function HelpIndexPage() {
  const grouped = getHelpArticlesByCategory();

  return (
    <div className="publicPage">
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/help" aria-current="page">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      <div className="publicContent">
        <h1>Help centre</h1>
        <p className="publicLead">Step-by-step guides for every part of Akunta.</p>

        {Object.entries(grouped).map(([category, articles]) => (
          <section key={category} className="helpCategory">
            <h2>{category}</h2>
            <ul className="helpArticleList">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link href={`/help/${article.slug}`} className="helpArticleLink">
                    <strong>{article.title}</strong>
                    <span className="helpArticleExcerpt">{article.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="helpFooterNote">
          <p>
            Can&apos;t find what you&apos;re looking for?{" "}
            <Link href="/support">Contact support</Link>.
          </p>
        </div>
      </div>

      <footer className="publicFooter">
        <div className="publicFooterInner">
          <nav className="publicFooterLinks">
            <Link href="/">Home</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <p className="publicFooterLegal">&copy; {new Date().getFullYear()} Akunta</p>
        </div>
      </footer>
    </div>
  );
}
