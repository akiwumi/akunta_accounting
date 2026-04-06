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

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  const pathname = headers().get("x-pathname") ?? "/";
  const isLoginRoute = pathname.startsWith("/login");

  return (
    <html lang={locale} className={`${manrope.variable} ${notoSerif.variable} ${inter.variable}`}>
      <body className={isLoginRoute ? "authRouteBody" : undefined}>
        {isLoginRoute ? (
          <main className="authRouteMain routeFade">{children}</main>
        ) : (
          <div className="appShell routeFade">
            <AppNav locale={locale} />
            <div className="appMain">
              <PageSubNav locale={locale} />
              <main className="container routeFade">{children}</main>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
