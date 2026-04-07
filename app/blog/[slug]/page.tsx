import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { getBlogPost, blogPosts } from "@/lib/content/blog";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const post = getBlogPost(params.slug);
  if (!post) return { title: "Not found — Akunta Blog" };
  return { title: `${post.title} — Akunta Blog`, description: post.excerpt };
}

export default function BlogArticlePage({ params }: Props) {
  const post = getBlogPost(params.slug);
  if (!post) notFound();

  // Convert simple **bold**, numbered steps, and paragraphs to HTML
  const bodyHtml = post.body
    .split("\n\n")
    .map((para) => {
      const withBold = para.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      if (para.split("\n").every((l) => /^\d+\./.test(l.trim()))) {
        const items = para
          .split("\n")
          .map((l) => `<li>${l.replace(/^\d+\.\s*/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }
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
          <Link href="/blog">Blog</Link>
        </nav>

        <time className="publicBlogDate" dateTime={post.date}>
          {new Date(post.date).toLocaleDateString("en-GB", {
            year: "numeric",
            month: "long",
            day: "numeric"
          })}
        </time>

        <h1>{post.title}</h1>
        <p className="publicLead">{post.excerpt}</p>
        <p className="articleByline">By {post.author}</p>

        <div
          className="articleBody"
          // Content is from our own static data — no user input
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        <div className="articleFooterNav">
          <Link href="/blog" className="button tertiary">
            ← All articles
          </Link>
        </div>
      </div>

      <footer className="publicFooter">
        <div className="publicFooterInner">
          <nav className="publicFooterLinks">
            <Link href="/">Home</Link>
            <Link href="/help">Help</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <p className="publicFooterLegal">&copy; {new Date().getFullYear()} Akunta</p>
        </div>
      </footer>
    </div>
  );
}
