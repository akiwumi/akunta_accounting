import type { Metadata } from "next";
import { ReactNode } from "react";

import { AppNav } from "@/components/layout/AppNav";
import { PageSubNav } from "@/components/layout/PageSubNav";
import { getRequestLocale } from "@/lib/i18n/locale";

import "./globals.css";

export const metadata: Metadata = {
  title: "NorthLedger",
  description: "Accounting app for sole traders in Sweden with EU/UK-ready architecture."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();

  return (
    <html lang={locale}>
      <body>
        <div className="appShell">
          <AppNav locale={locale} />
          <div className="appMain">
            <PageSubNav locale={locale} />
            <main className="container">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
