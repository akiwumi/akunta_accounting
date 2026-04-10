"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const CONSENT_COOKIE = "cookie_consent";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getStoredConsent(): "all" | "essential" | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split(";").find((c) => c.trim().startsWith(`${CONSENT_COOKIE}=`));
  const val = match?.split("=")[1]?.trim();
  return val === "all" || val === "essential" ? val : null;
}

function setConsentCookie(choice: "all" | "essential") {
  document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

export function CookieConsentBanner() {
  // undefined = not yet read; null = no consent stored; string = choice made
  const [consent, setConsent] = useState<"all" | "essential" | null | undefined>(undefined);

  useEffect(() => {
    setConsent(getStoredConsent());
  }, []);

  const save = (choice: "all" | "essential") => {
    setConsentCookie(choice);
    // Persist to DB if the user is logged in (best-effort)
    fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cookieConsent: choice })
    }).catch(() => {});
    setConsent(choice);
  };

  // Don't render until we've read the cookie (avoids flash)
  // Don't render if a choice has already been made
  if (consent !== null) return null;

  return (
    <div className="cookieBanner" role="dialog" aria-label="Cookie consent" aria-live="polite">
      <div className="cookieBannerInner">
        <div className="cookieBannerText">
          <p className="cookieBannerTitle">We use cookies</p>
          <p className="cookieBannerBody">
            We use essential cookies to keep you signed in, and optional cookies for error monitoring
            and anonymous usage analytics. No personal or financial data is included in analytics.{" "}
            <Link href="/privacy" className="cookieBannerLink">Privacy policy</Link>
          </p>
        </div>
        <div className="cookieBannerActions">
          <button
            type="button"
            className="button secondary cookieBannerBtn"
            onClick={() => save("essential")}
          >
            Essential only
          </button>
          <button
            type="button"
            className="button cookieBannerBtn"
            onClick={() => save("all")}
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
