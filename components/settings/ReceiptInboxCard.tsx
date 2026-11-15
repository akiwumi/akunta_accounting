"use client";

import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type ReceiptInboxCardProps = {
  locale: Locale;
  initialAddress: string | null;
  /** False when the server has no inbound mail domain configured. */
  available: boolean;
};

export const ReceiptInboxCard = ({ locale, initialAddress, available }: ReceiptInboxCardProps) => {
  const [address, setAddress] = useState(initialAddress);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy =
    locale === "sv"
      ? {
          title: "Kvitton via e-post",
          intro:
            "Vidarebefordra kvitton och fakturor till din privata adress så läses de in automatiskt. Säkra kvitton bokförs direkt, övriga hamnar under Granska.",
          unavailable: "Kvitton via e-post är inte aktiverat på den här servern ännu.",
          create: "Skapa min adress",
          copyAddress: "Kopiera",
          copied: "Kopierad",
          replace: "Byt adress",
          replaceConfirm: "Byta adress? Den gamla adressen slutar fungera direkt.",
          disable: "Stäng av",
          disableConfirm: "Stänga av kvitton via e-post? Adressen slutar fungera direkt.",
          secret: "Håll adressen hemlig. Alla som har den kan skicka in kvitton till din bokföring.",
          working: "Sparar...",
          failed: "Kunde inte uppdatera adressen."
        }
      : {
          title: "Receipts by email",
          intro:
            "Forward receipts and invoices to your private address and they are read in automatically. Clear receipts are booked at once, the rest wait under Review.",
          unavailable: "Receipts by email is not switched on for this server yet.",
          create: "Create my address",
          copyAddress: "Copy",
          copied: "Copied",
          replace: "Replace address",
          replaceConfirm: "Replace the address? The old one stops working at once.",
          disable: "Switch off",
          disableConfirm: "Switch off receipts by email? The address stops working at once.",
          secret: "Keep the address private. Anyone who has it can send receipts into your books.",
          working: "Saving...",
          failed: "Could not update the address."
        };

  const call = async (method: "POST" | "DELETE") => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/settings/receipt-inbox", { method });
      const json = (await response.json()) as { address?: string | null; error?: string };
      if (!response.ok) throw new Error(json.error ?? copy.failed);
      setAddress(json.address ?? null);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : copy.failed);
    } finally {
      setLoading(false);
    }
  };

  const onCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="stack">
      <h2>{copy.title}</h2>
      <p className="note">{copy.intro}</p>
      {!available && <p className="note">{copy.unavailable}</p>}
      {available && !address && (
        <div className="row">
          <button type="button" onClick={() => call("POST")} disabled={loading}>
            {loading ? copy.working : copy.create}
          </button>
        </div>
      )}
      {available && address && (
        <>
          <p>
            <code>{address}</code>
          </p>
          <div className="row">
            <button type="button" onClick={onCopy} disabled={loading}>
              {copied ? copy.copied : copy.copyAddress}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => {
                if (window.confirm(copy.replaceConfirm)) void call("POST");
              }}
            >
              {copy.replace}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => {
                if (window.confirm(copy.disableConfirm)) void call("DELETE");
              }}
            >
              {copy.disable}
            </button>
          </div>
          <p className="note">{copy.secret}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
};
