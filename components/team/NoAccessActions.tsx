"use client";

import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type Business = { id: string; name: string; role: "owner" | "accountant" | "viewer" };

export const NoAccessActions = ({ locale, businesses }: { locale: Locale; businesses: Business[] }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy =
    locale === "sv"
      ? {
          open: (name: string) => `Öppna ${name}`,
          logout: "Logga ut",
          failed: "Kunde inte öppna företaget. Försök igen."
        }
      : {
          open: (name: string) => `Open ${name}`,
          logout: "Log out",
          failed: "Could not open the business. Please try again."
        };

  const open = async (businessId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId })
      });
      if (!response.ok) throw new Error(copy.failed);
      window.location.assign("/dashboard");
    } catch {
      setError(copy.failed);
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  };

  return (
    <div className="stack">
      {businesses.map((business) => (
        <button key={business.id} type="button" disabled={busy} onClick={() => void open(business.id)}>
          {copy.open(business.name)}
        </button>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
        {copy.logout}
      </button>
    </div>
  );
};
