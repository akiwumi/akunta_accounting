import type { Metadata } from "next";
import { Inter, Manrope, Noto_Serif } from "next/font/google";
import { cookies } from "next/headers";
import { ReactNode } from "react";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { AppShellWrapper } from "@/components/layout/AppShellWrapper";
import { CookieConsentBanner } from "@/components/layout/CookieConsentBanner";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { getRequestLocale } from "@/lib/i18n/locale";
import { buildPageMetadata } from "@/lib/seo";

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
  ...buildPageMetadata(),
  formatDetection: {
    email: false,
    address: false,
    telephone: false
  },
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  const hasSession = Boolean(cookies().get(AUTH_COOKIE_NAME)?.value);

  return (
    <html lang={locale} className={`${manrope.variable} ${notoSerif.variable} ${inter.variable}`}>
      <body>
        <AppShellWrapper locale={locale} hasSession={hasSession}>
          {children}
        </AppShellWrapper>
        <CookieConsentBanner />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
