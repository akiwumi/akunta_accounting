/** Small helpers shared by the invoicing route handlers. */

import { NextResponse } from "next/server";
import { type z } from "zod";

import { ledgerErrorResponse } from "@/lib/accounting/ledger";
import { requireAuthContext } from "@/lib/auth/context";
import { getRequestLocale } from "@/lib/i18n/locale";
import { RotRutError, rotRutErrorText } from "@/lib/invoices/rotrut";

export const authOrNull = async () => {
  try {
    return await requireAuthContext();
  } catch {
    return null;
  }
};

export const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export const unauthorized = () => jsonError("Unauthorized.", 401);

/** Picks the Swedish or English text for the person making the request. */
export const requestText = async () => {
  const locale = await getRequestLocale();
  return (sv: string, en: string) => (locale === "sv" ? sv : en);
};

export const zodMessage = (error: z.ZodError) => {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
};

/** Turns a failed ledger posting into a response the user can act on. Null when it is not a ledger failure. */
export const postingErrorResponse = (error: unknown, t: (sv: string, en: string) => string) => {
  const mapped = ledgerErrorResponse(error);
  const text = error instanceof Error ? error.message : "";
  if (mapped?.status === 409 && (mapped.message.includes("locked") || text.includes("LEDGER_PERIOD_LOCKED"))) {
    return jsonError(
      t(
        "Datumet ligger i en låst bokföringsperiod. Välj ett datum i en öppen period.",
        "That date is in a locked accounting period. Choose a date in an open period."
      ),
      409
    );
  }
  if (mapped) return jsonError(mapped.message, mapped.status);
  if (text.includes("locked accounting period")) {
    return jsonError(
      t(
        "Datumet ligger i en låst bokföringsperiod. Välj ett datum i en öppen period.",
        "That date is in a locked accounting period. Choose a date in an open period."
      ),
      409
    );
  }
  return null;
};

/** A ROT/RUT rule that was not met, in the user's language. Null when the error is something else. */
export const rotRutErrorResponse = (error: unknown, t: (sv: string, en: string) => string) =>
  error instanceof RotRutError
    ? jsonError(t(rotRutErrorText(error.code, "sv"), rotRutErrorText(error.code, "en")), error.status)
    : null;
