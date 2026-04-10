"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { type Locale } from "@/lib/i18n/locale";

const links = [
  // ── Main bookkeeping ──────────────────────────────────────────────────
  { href: "/", icon: "HM", group: "main", labels: { en: "Home", sv: "Hem" } },
  { href: "/dashboard", icon: "DB", group: "main", labels: { en: "Dashboard", sv: "Översikt" } },
  { href: "/receipts", icon: "RC", group: "main", labels: { en: "Receipts", sv: "Kvitton" } },
  { href: "/invoices", icon: "IV", group: "main", labels: { en: "Invoices", sv: "Fakturor" } },
  { href: "/imports", icon: "BC", group: "main", labels: { en: "Bank CSV", sv: "Bank-CSV" } },
  { href: "/transactions", icon: "TX", group: "main", labels: { en: "Transactions", sv: "Transaktioner" } },
  { href: "/salaries", icon: "SL", group: "main", labels: { en: "Salaries", sv: "Löner" } },
  { href: "/ledger", icon: "LG", group: "main", labels: { en: "Ledger", sv: "Huvudbok" } },
  { href: "/review", icon: "RV", group: "main", labels: { en: "Review", sv: "Granskning" } },
  // ── Swedish tax requirements ──────────────────────────────────────────
  { href: "/assets", icon: "FA", group: "tax", labels: { en: "Fixed Assets", sv: "Inventarier" } },
  { href: "/mileage", icon: "KJ", group: "tax", labels: { en: "Mileage Log", sv: "Körjournal" } },
  { href: "/periodiseringsfond", icon: "PF", group: "tax", labels: { en: "Tax Reserves", sv: "Periodiseringsfond" } },
  { href: "/compliance", icon: "CK", group: "tax", labels: { en: "Compliance", sv: "Kravlista" } },
  { href: "/audit", icon: "AL", group: "tax", labels: { en: "Audit Trail", sv: "Revisionslogg" } },
  // ── Reports, settings & support ───────────────────────────────────────
  { href: "/reports", icon: "RP", group: "other", labels: { en: "Reports", sv: "Rapporter" } },
  { href: "/settings", icon: "ST", group: "other", labels: { en: "Settings", sv: "Inställningar" } },
  { href: "/support", icon: "SP", group: "other", labels: { en: "Support", sv: "Support" } }
] as const;

const copy = {
  en: {
    main: "",
    tax: "Swedish Tax",
    other: "Other",
    language: "Language",
    english: "English",
    swedish: "Swedish",
    logout: "Log out",
    menu: "Menu",
    close: "Close menu"
  },
  sv: {
    main: "",
    tax: "Skatteunderlag",
    other: "Övrigt",
    language: "Språk",
    english: "Engelska",
    swedish: "Svenska",
    logout: "Logga ut",
    menu: "Meny",
    close: "Stäng meny"
  }
} as const;

export const AppNav = ({ locale }: { locale: Locale }) => {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const labels = copy[locale];
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActiveLink = (href: string) => {
    if (href === "/" || href === "/dashboard") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const groups: Array<{ key: "main" | "tax" | "other"; label: string }> = [
    { key: "main", label: labels.main },
    { key: "tax", label: labels.tax },
    { key: "other", label: labels.other }
  ];

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const navLinks = (
    <>
      <div className="sideNavSections">
        {groups.map(({ key, label }) => (
          <div className="sideNavGroup" key={key}>
            {label ? <p className="sideNavSectionLabel">{label}</p> : null}
            {links
              .filter((link) => link.group === key)
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`sideNavLink${isActiveLink(link.href) ? " active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="sideNavIcon" aria-hidden>
                    {link.icon}
                  </span>
                  <span className="sideNavLinkText">{link.labels[locale]}</span>
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="sideNavFooter">
        <LanguageSwitcher
          locale={locale}
          label={labels.language}
          englishLabel={labels.english}
          swedishLabel={labels.swedish}
        />
        <button type="button" className="secondary navLogoutButton" onClick={logout}>
          {labels.logout}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside className="sideNav sideNavDesktop">
        <Link href="/" className="sideNavBrand">
          <Image src="/akunta_logo.png" alt="Akunta" width={610} height={614} className="brandLogoFull" priority />
          <p className="brandSubline">Bookkeeping Accounting</p>
        </Link>
        {navLinks}
      </aside>

      {/* Mobile top bar */}
      <header className="mobileTopBar">
        <div className="mobileTopBarBrand">
          <Image src="/akunta_logo.png" alt="Akunta" width={28} height={28} className="mobileTopBarLogo" />
          <span className="mobileTopBarWordmark">Akunta</span>
        </div>
        <button
          type="button"
          className="mobileMenuToggle"
          aria-label={mobileOpen ? labels.close : labels.menu}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span className={`hamburger${mobileOpen ? " hamburgerOpen" : ""}`} aria-hidden>
            <span /><span /><span />
          </span>
        </button>
      </header>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div
          className="mobileNavOverlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside className={`mobileNavDrawer${mobileOpen ? " mobileNavDrawerOpen" : ""}`} aria-label="Navigation">
        <Link href="/" className="sideNavBrand mobileDrawerBrand" onClick={() => setMobileOpen(false)}>
          <Image src="/akunta_logo.png" alt="Akunta" width={36} height={36} className="brandLogoFull" />
          <p className="brandSubline">Bookkeeping Accounting</p>
        </Link>
        {navLinks}
      </aside>
    </>
  );
};
