"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppNav } from "@/components/layout/AppNav";
import { PageSubNav } from "@/components/layout/PageSubNav";
import { UserPreferencesProvider } from "@/components/providers/UserPreferencesProvider";
import { type Locale } from "@/lib/i18n/locale";

const AUTH_PREFIXES = ["/login", "/register", "/sign-in", "/forgot-password", "/reset-password"];
const PUBLIC_PREFIXES = ["/blog", "/help", "/support", "/resources", "/pricing", "/welcome", "/privacy", "/terms"];

const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutes

function isAuthRoute(pathname: string) {
  return AUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicPage(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function InactivityWatcher() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } finally {
        window.location.href = "/";
      }
    }, INACTIVITY_MS);
  }, []);

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  return null;
}

export function AppShellWrapper({
  locale,
  hasSession,
  children
}: {
  locale: Locale;
  hasSession: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const authRoute = isAuthRoute(pathname);
  const publicPage = isPublicPage(pathname);
  const showAppShell = hasSession && !authRoute && !publicPage;

  // Keep body class in sync with route type for auth-page CSS
  useEffect(() => {
    if (authRoute) {
      document.body.classList.add("authRouteBody");
    } else {
      document.body.classList.remove("authRouteBody");
    }
  }, [authRoute]);

  if (authRoute) {
    return <main className="authRouteMain routeFade">{children}</main>;
  }

  if (showAppShell) {
    return (
      <UserPreferencesProvider>
        <div className="appShell routeFade">
          <InactivityWatcher />
          <AppNav locale={locale} />
          <div className="appMain">
            <PageSubNav locale={locale} />
            <main className="container routeFade">{children}</main>
          </div>
        </div>
      </UserPreferencesProvider>
    );
  }

  return <main className="publicMain routeFade">{children}</main>;
}
