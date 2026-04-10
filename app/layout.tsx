import type { Metadata } from "next";
import { Inter, Manrope, Noto_Serif } from "next/font/google";
import { cookies, headers } from "next/headers";
import { ReactNode } from "react";

import { AppNav } from "@/components/layout/AppNav";
import { PageSubNav } from "@/components/layout/PageSubNav";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
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

// Auth entry pages — always get the plain auth layout regardless of session
function isAuthRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  );
}

// Public marketing / info pages — never show the app shell
const PUBLIC_PREFIXES = ["/", "/welcome", "/blog", "/help", "/support", "/resources", "/pricing"];

function isPublicPage(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.filter((p) => p !== "/").some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getRequestLocale();
  // pathname may be "" if the x-pathname middleware header wasn't forwarded;
  // treat unknown as neither auth nor public so the cookie decides.
  const pathname = headers().get("x-pathname") ?? "";
  const hasSession = Boolean(cookies().get(AUTH_COOKIE_NAME)?.value);

  const authRoute = isAuthRoute(pathname);
  // knownPublicPage is only true when we positively identify the route as public.
  // An empty/unknown pathname does NOT count as public.
  const knownPublicPage = pathname !== "" && isPublicPage(pathname);

  // Show app shell whenever the user has a valid session and is not on an
  // auth page or a known public page. The session cookie is the source of
  // truth — this survives missing x-pathname headers and hard redirects.
  const appShell = hasSession && !authRoute && !knownPublicPage;

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
