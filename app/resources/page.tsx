import Link from "next/link";

import { resources, getResourceCategories } from "@/lib/content/resources";

export const metadata = {
  title: "Resources — Akunta",
  description: "Tax, accounting, and compliance resources for Swedish sole traders and EU businesses."
};

// Default to Sweden — in future, resolve from Accept-Language or user profile
const DEFAULT_COUNTRY = "SE";

export default function ResourcesPage() {
  const categories = getResourceCategories();

  // Group resources by category, keeping SE-applicable and global resources
  const grouped: Record<string, typeof resources> = {};
  for (const resource of resources) {
    const appliesToDefault =
      resource.countries === null || resource.countries.includes(DEFAULT_COUNTRY);
    if (!appliesToDefault) continue;
    if (!grouped[resource.category]) grouped[resource.category] = [];
    grouped[resource.category].push(resource);
  }

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
            <Link href="/resources" aria-current="page">Resources</Link>
            <Link href="/support">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      <div className="publicContent">
        <h1>Resources</h1>
        <p className="publicLead">
          Useful links for Swedish sole traders — tax authorities, registration portals, and accounting standards.
        </p>

        {categories
          .filter((cat) => grouped[cat]?.length)
          .map((category) => (
            <section key={category} className="resourceCategory">
              <h2>{category}</h2>
              <ul className="resourceList">
                {grouped[category].map((r) => (
                  <li key={r.url} className="resourceItem">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="resourceLink">
                      {r.title}
                    </a>
                    <p className="resourceDescription">{r.description}</p>
                    {r.countries ? (
                      <span className="resourceCountryBadge">
                        {r.countries.join(", ")}
                      </span>
                    ) : (
                      <span className="resourceCountryBadge resourceCountryGlobal">Global</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

        <p className="note">
          Resources are currently filtered for Sweden. Support for additional countries is coming soon.
        </p>
      </div>

      <footer className="publicFooter">
        <div className="publicFooterInner">
          <nav className="publicFooterLinks">
            <Link href="/">Home</Link>
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/support">Support</Link>
          </nav>
          <p className="publicFooterLegal">&copy; {new Date().getFullYear()} Akunta</p>
        </div>
      </footer>
    </div>
  );
}
