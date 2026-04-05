"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type ReceiptReviewActionsProps = {
  receiptId: string;
  needsReview: boolean;
  locale: Locale;
};

export const ReceiptReviewActions = ({ receiptId, needsReview, locale }: ReceiptReviewActionsProps) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy =
    locale === "sv"
      ? {
          markReviewed: "Markera som granskad",
          markNeedsReview: "Markera för granskning",
          saving: "Sparar...",
          failed: "Kunde inte uppdatera granskningsstatus."
        }
      : {
          markReviewed: "Mark as reviewed",
          markNeedsReview: "Mark as needs review",
          saving: "Saving...",
          failed: "Failed to update review status."
        };

  const onToggle = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needsReview: !needsReview })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? copy.failed);
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : copy.failed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <button type="button" onClick={onToggle} disabled={loading}>
          {loading ? copy.saving : needsReview ? copy.markReviewed : copy.markNeedsReview}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
