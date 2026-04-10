import Link from "next/link";

import { blogPosts } from "@/lib/content/blog";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Blog",
  description: "Guides, bookkeeping tips, and product updates for Swedish sole traders.",
  path: "/blog"
});

const sorted = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));

export default function BlogIndexPage() {
  return (
    <div className="publicPage">
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/help">Help</Link>
            <Link href="/blog" aria-current="page">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      <div className="publicContent">
        <h1>Blog</h1>
        <p className="publicLead">Practical guides and bookkeeping tips for Swedish sole traders.</p>

        <div className="blogList">
          {sorted.map((post) => (
            <article key={post.slug} className="blogListItem">
              <time className="publicBlogDate" dateTime={post.date}>
                {new Date(post.date).toLocaleDateString("en-GB", {
                  year: "numeric",
                  month: "long",
                  day: "numeric"
                })}
              </time>
              <h2>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.excerpt}</p>
              <Link href={`/blog/${post.slug}`} className="publicBlogReadMore">
                Read more →
              </Link>
            </article>
          ))}
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
