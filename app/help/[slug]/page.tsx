import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { getHelpArticle, helpArticles } from "@/lib/content/help";
import { buildPageMetadata } from "@/lib/seo";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return helpArticles.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const article = getHelpArticle(params.slug);
  if (!article) {
    return buildPageMetadata({
      title: "Help Article Not Found",
      description: "The requested Akunta help article could not be found.",
      path: `/help/${params.slug}`,
      noIndex: true
    });
  }

  return buildPageMetadata({
    title: article.title,
    description: article.excerpt,
    path: `/help/${article.slug}`,
    type: "article",
    section: article.category,
    authors: ["Akunta Team"]
  });
}

export default function HelpArticlePage({ params }: Props) {
  const article = getHelpArticle(params.slug);
  if (!article) notFound();

  // Convert simple **bold** and newlines to basic HTML
  const bodyHtml = article.body
    .split("\n\n")
    .map((para) => {
      const withBold = para.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      if (para.startsWith("- ")) {
        const items = para
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => `<li>${l.slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${withBold}</p>`;
    })
    .join("");

  return (
    <div className="publicPage">
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      <div className="publicContent publicArticle">
        <nav className="articleBreadcrumb">
          <Link href="/help">Help</Link> / {article.category}
        </nav>

        <h1>{article.title}</h1>
        <p className="publicLead">{article.excerpt}</p>

        <div
          className="articleBody"
          // Content is generated from our own static data — no user input
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        <div className="articleFooterNav">
          <Link href="/help" className="button tertiary">
            ← Back to Help
          </Link>
          <Link href="/support">Need more help? Contact support</Link>
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
