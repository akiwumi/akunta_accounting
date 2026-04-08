"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

type WelcomeConfirmationActionsProps = {
  awaitingSupabaseConfirmation: boolean;
  isAuthenticated: boolean;
  token: string | null;
};

type VerificationState = "confirmed" | "verifying" | "idle" | "error";

export function WelcomeConfirmationActions({
  awaitingSupabaseConfirmation,
  isAuthenticated,
  token
}: WelcomeConfirmationActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<VerificationState>(
    token || awaitingSupabaseConfirmation ? "verifying" : isAuthenticated ? "confirmed" : "idle"
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && !token && !awaitingSupabaseConfirmation) {
      setError(null);
      setStatus("confirmed");
      return;
    }

    const hash = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    const accessToken = new URLSearchParams(hash).get("access_token");

    if (accessToken) {
      let cancelled = false;

      async function completeSupabaseConfirmation() {
        setError(null);
        setStatus("verifying");

        try {
          const response = await fetch("/api/auth/complete-supabase", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json"
            },
            body: JSON.stringify({ accessToken })
          });
          const payload = (await response.json().catch(() => ({}))) as { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Could not complete your account confirmation.");
          }

          if (cancelled) {
            return;
          }

          setStatus("confirmed");
          startTransition(() => {
            router.replace("/welcome?confirmed=1");
            router.refresh();
          });
        } catch (completionError) {
          if (cancelled) {
            return;
          }

          setStatus("error");
          setError(
            completionError instanceof Error
              ? completionError.message
              : "We couldn't complete your account confirmation."
          );
        }
      }

      void completeSupabaseConfirmation();

      return () => {
        cancelled = true;
      };
    }

    if (!token) {
      setError(null);
      if (awaitingSupabaseConfirmation) {
        setStatus("error");
        setError("Supabase confirmation data is missing. Please open the latest confirmation email and try again.");
      } else {
        setStatus(isAuthenticated ? "confirmed" : "idle");
      }
      return;
    }

    let cancelled = false;

    async function confirmEmail() {
      setError(null);
      setStatus("verifying");

      try {
        const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({ token })
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not confirm your account.");
        }

        if (cancelled) {
          return;
        }

        setError(null);
        setStatus("confirmed");
        startTransition(() => {
          router.replace("/welcome?confirmed=1");
          router.refresh();
        });
      } catch (verificationError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setError(
          verificationError instanceof Error
            ? verificationError.message
            : "We couldn't confirm your account with that link."
        );
      }
    }

    void confirmEmail();

    return () => {
      cancelled = true;
    };
  }, [awaitingSupabaseConfirmation, isAuthenticated, router, token]);

  const isConfirmed = status === "confirmed";
  const ctaHref = isConfirmed ? "/dashboard" : "/login";
  const ctaLabel = isConfirmed
    ? "Fortsätt till din dashboard / Continue to your dashboard"
    : "Gå till inloggning / Go to sign in";
  const statusLabel = {
    confirmed: "Konto bekräftat / Account confirmed",
    verifying: "Bekräftar ditt konto... / Confirming your account...",
    idle: "Logga in för att fortsätta / Sign in to continue",
    error: "Länken kunde inte bekräftas / We couldn't verify this link"
  }[status];
  const note = {
    confirmed: "Du är redo att fortsätta till din arbetsyta. / You're ready to continue to your workspace.",
    verifying: "Vi öppnar din arbetsyta så snart bekräftelsen är klar. / We'll open your workspace as soon as confirmation finishes.",
    idle: "Om du redan har bekräftat ditt konto kan du logga in och fortsätta. / If you already confirmed your account, sign in to continue.",
    error:
      "Länken kan vara ogiltig, ha använts tidigare eller sakna bekräftelsedata. Du kan logga in eller be om en ny bekräftelselänk. / This link may be invalid, already used, or missing confirmation data. You can sign in or request a new confirmation link."
  }[status];

  return (
    <div className="welcomeActions">
      <div className={`welcomeStatus welcomeStatus--${status}`} role="status" aria-live="polite">
        <span className="welcomeStatusDot" aria-hidden />
        {statusLabel}
      </div>

      <Link
        href={ctaHref}
        className={`button welcomeStartBtn${!isConfirmed ? " welcomeStartBtnMuted" : ""}`}
        aria-disabled={!isConfirmed && status === "verifying"}
        onClick={(event) => {
          if (status === "verifying") {
            event.preventDefault();
          }
        }}
      >
        {status === "verifying"
          ? "Bekräftar konto... / Confirming account..."
          : ctaLabel}
      </Link>

      <p className="welcomeNote">{error ?? note}</p>
    </div>
  );
}
