"use client";

import { useEffect, useState } from "react";

import { useSessionInfo } from "@/components/layout/SessionContext";
import { type Locale } from "@/lib/i18n/locale";

const DENIED_HEADER = "x-akunta-denied";

const text = {
  en: {
    banner: (name: string) =>
      `You have read-only access to ${name}. You can view and download everything, but not change anything.`,
    read_only: "You have read-only access. Nothing was changed.",
    owner_only: "Only the owner of the business can do this. Nothing was changed.",
    dismiss: "Close"
  },
  sv: {
    banner: (name: string) =>
      `Du har läsbehörighet i ${name}. Du kan se och ladda ner allt, men inte ändra något.`,
    read_only: "Du har läsbehörighet. Inget ändrades.",
    owner_only: "Det här kan bara företagets ägare göra. Inget ändrades.",
    dismiss: "Stäng"
  }
} as const;

/** A quiet line above every page for a read-only member. */
export const ReadOnlyBanner = ({ locale }: { locale: Locale }) => {
  const { current } = useSessionInfo();
  if (current?.role !== "viewer") return null;
  return (
    <p className="note" role="status" style={{ padding: "10px 24px 0" }}>
      {text[locale].banner(current.name)}
    </p>
  );
};

/**
 * Says so, in words, whenever the server refuses a request because of the
 * person's role. It watches every fetch the app makes, so a form that only
 * knows how to show "Something went wrong" is still explained.
 */
export const AccessDeniedNotice = ({ locale }: { locale: Locale }) => {
  const { refresh } = useSessionInfo();
  const [denial, setDenial] = useState<"read_only" | "owner_only" | null>(null);

  useEffect(() => {
    const original = window.fetch;
    const watched: typeof window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 403) {
        const reason = response.headers.get(DENIED_HEADER);
        if (reason === "read_only" || reason === "owner_only") {
          setDenial(reason);
          // The role may have changed since the page loaded.
          void refresh();
        }
      }
      return response;
    };
    window.fetch = watched;
    return () => {
      if (window.fetch === watched) window.fetch = original;
    };
  }, [refresh]);

  useEffect(() => {
    if (!denial) return;
    const timer = setTimeout(() => setDenial(null), 8000);
    return () => clearTimeout(timer);
  }, [denial]);

  if (!denial) return null;
  return (
    <div
      role="alert"
      className="card row"
      style={{ position: "fixed", right: 20, bottom: 20, zIndex: 60, maxWidth: 420, justifyContent: "space-between" }}
    >
      <p style={{ margin: 0 }}>{text[locale][denial]}</p>
      <button type="button" className="secondary" onClick={() => setDenial(null)}>
        {text[locale].dismiss}
      </button>
    </div>
  );
};
