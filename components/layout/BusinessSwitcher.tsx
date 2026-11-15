"use client";

import { useState } from "react";

import { type SessionRole, useSessionInfo } from "@/components/layout/SessionContext";
import { type Locale } from "@/lib/i18n/locale";

const text = {
  en: {
    label: "Books of",
    choose: "Switch business",
    roles: { owner: "Owner", accountant: "Accountant", viewer: "Read-only access" } as Record<SessionRole, string>,
    failed: "Could not switch business."
  },
  sv: {
    label: "Bokföring för",
    choose: "Byt företag",
    roles: { owner: "Ägare", accountant: "Redovisningskonsult", viewer: "Läsbehörighet" } as Record<SessionRole, string>,
    failed: "Kunde inte byta företag."
  }
} as const;

export const roleLabel = (role: SessionRole, locale: Locale) => text[locale].roles[role];

/**
 * Whose books these are and what the person may do in them. With more than
 * one business it is also how they move between them.
 */
export const BusinessSwitcher = ({ locale }: { locale: Locale }) => {
  const { current, businesses } = useSessionInfo();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = text[locale];

  if (!current) return null;

  const switchTo = async (businessId: string) => {
    if (businessId === current.id) return;
    setSwitching(true);
    setError(null);
    try {
      const response = await fetch("/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId })
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? copy.failed);
      }
      // Full load: every page must be rendered again for the other business.
      window.location.assign("/dashboard");
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : copy.failed);
      setSwitching(false);
    }
  };

  return (
    <div className="navLocaleControl" style={{ padding: "2px 8px 6px" }}>
      <span className="note">{copy.label}</span>
      {businesses.length > 1 ? (
        <select
          aria-label={copy.choose}
          value={current.id}
          disabled={switching}
          onChange={(event) => void switchTo(event.target.value)}
        >
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
      ) : (
        <strong style={{ overflowWrap: "anywhere" }}>{current.name}</strong>
      )}
      <span>
        <span className="badge">{copy.roles[current.role]}</span>
      </span>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
