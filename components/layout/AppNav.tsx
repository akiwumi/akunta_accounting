"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { type Locale } from "@/lib/i18n/locale";

const links = [
  { href: "/", icon: "DB", group: "main", labels: { en: "Dashboard", sv: "Översikt" } },
  { href: "/receipts", icon: "RC", group: "main", labels: { en: "Receipts", sv: "Kvitton" } },
  { href: "/invoices", icon: "IV", group: "main", labels: { en: "Invoices", sv: "Fakturor" } },
  { href: "/imports", icon: "BC", group: "main", labels: { en: "Bank CSV", sv: "Bank-CSV" } },
  { href: "/transactions", icon: "TX", group: "main", labels: { en: "Transactions", sv: "Transaktioner" } },
  { href: "/ledger", icon: "LG", group: "main", labels: { en: "Ledger", sv: "Huvudbok" } },
  { href: "/review", icon: "RV", group: "main", labels: { en: "Review", sv: "Granskning" } },
  { href: "/reports", icon: "RP", group: "other", labels: { en: "Reports", sv: "Rapporter" } },
  { href: "/settings", icon: "ST", group: "other", labels: { en: "Settings", sv: "Inställningar" } }
] as const;

const copy = {
  en: {
    main: "Main",
    other: "Other",
    language: "Language",
    english: "English",
    swedish: "Swedish"
  },
  sv: {
    main: "Huvud",
    other: "Övrigt",
    language: "Språk",
    english: "Engelska",
    swedish: "Svenska"
  }
} as const;

export const AppNav = ({ locale }: { locale: Locale }) => {
  const pathname = usePathname() || "/";
  const labels = copy[locale];

  const isActiveLink = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="sideNav">
      <div className="sideNavBrand">
        <div className="brandMark" aria-hidden>
          N
        </div>
        <div className="brandCopy">
          <p className="brandName">NorthLedger</p>
          <p className="brandTagline">Business Accounting</p>
        </div>
      </div>
      <div className="sideNavSections">
        <div className="sideNavGroup">
          <p className="sideNavSectionLabel">{labels.main}</p>
          {links
            .filter((link) => link.group === "main")
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`sideNavLink${isActiveLink(link.href) ? " active" : ""}`}
              >
                <span className="sideNavIcon" aria-hidden>
                  {link.icon}
                </span>
                <span className="sideNavLinkText">{link.labels[locale]}</span>
              </Link>
            ))}
        </div>
        <div className="sideNavGroup">
          <p className="sideNavSectionLabel">{labels.other}</p>
          {links
            .filter((link) => link.group === "other")
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`sideNavLink${isActiveLink(link.href) ? " active" : ""}`}
              >
                <span className="sideNavIcon" aria-hidden>
                  {link.icon}
                </span>
                <span className="sideNavLinkText">{link.labels[locale]}</span>
              </Link>
            ))}
        </div>
      </div>
      <div className="sideNavFooter">
        <LanguageSwitcher
          locale={locale}
          label={labels.language}
          englishLabel={labels.english}
          swedishLabel={labels.swedish}
        />
      </div>
    </aside>
  );
};
