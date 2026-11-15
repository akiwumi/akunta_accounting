import { NextResponse } from "next/server";

import { AccountError } from "@/lib/accounting/accounts";
import { JournalError } from "@/lib/accounting/journal";
import { ledgerErrorResponse } from "@/lib/accounting/ledger";

/**
 * Maps a failure to a JSON response. `code` lets the page show the message in
 * the user's language; `error` is the English fallback.
 */
export const journalErrorResponse = (error: unknown) => {
  if (error instanceof JournalError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof AccountError) {
    return NextResponse.json({ error: error.message, code: `ACCOUNT_${error.code}` }, { status: error.status });
  }
  const ledger = ledgerErrorResponse(error);
  if (ledger) return NextResponse.json({ error: ledger.message }, { status: ledger.status });
  console.error("[journal]", error);
  return NextResponse.json({ error: "Something went wrong. Nothing was booked." }, { status: 500 });
};

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
