import type { Metadata } from "next";
import { Inter, Manrope, Noto_Serif } from "next/font/google";
import { headers } from "next/headers";
import { ReactNode } from "react";

import { AppNav } from "@/components/layout/AppNav";
import { PageSubNav } from "@/components/layout/PageSubNav";
import { getRequestLocale } from "@/lib/i18n/locale";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap"
});

const notoSerif = Noto_Serif({
  subsets: ["latin"],
  variable: "--font-noto-serif",
  display: "swap"
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Akunta",
  description: "Accounting app for sole traders in Sweden with EU/UK-ready architecture.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png"
  }
};

// Routes that render inside the authenticated app shell (AppNav + PageSubNav)
const APP_SHELL_PREFIXES = [
  "/dashboard",
  "/receipts",
  "/invoices",
  "/transactions",
  "/ledger",
  "/reports",
  "/imports",
  "/assets",
  "/mileage",
  "/periodiseringsfond",
  "/salaries",
  "/compliance",
  "/review",
  "/settings"
];

function isAppShellRoute(pathname: string): boolean {
  return APP_SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith("/login") || pathname.startsWith("/register") || pathname.startsWith("/sign-in");
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  const pathname = headers().get("x-pathname") ?? "/";

  const authRoute = isAuthRoute(pathname);
  const appShell = isAppShellRoute(pathname);

  return (
    <html lang={locale} className={`${manrope.variable} ${notoSerif.variable} ${inter.variable}`}>
      <body className={authRoute ? "authRouteBody" : undefined}>
        {authRoute ? (
          <main className="authRouteMain routeFade">{children}</main>
        ) : appShell ? (
          <div className="appShell routeFade">
            <AppNav locale={locale} />
            <div className="appMain">
              <PageSubNav locale={locale} />
              <main className="container routeFade">{children}</main>
            </div>
          </div>
        ) : (
          // Public pages — no app chrome
          <main className="publicMain routeFade">{children}</main>
        )}
      </body>
    </html>
  );
}
