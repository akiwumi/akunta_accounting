/**
 * Skattekonto — tax account balance and transactions.
 *
 * Use for:
 *  - Showing live tax account balance on the dashboard
 *  - Reconciling tax payments
 *  - Displaying pending tax obligations
 */

import { skvRequest } from "./client";

export type SkattekontoBeloppPost = {
  typ: string;
  beskrivning: string;
  belopp: number;   // SEK öre
  bokfoeringsdatum: string;
  forfallodatum?: string;
};

export type SkattekontoResponse = {
  organisationsnummer: string;
  saldo: number;  // SEK öre — positive = credit, negative = debt
  poster: SkattekontoBeloppPost[];
};

/**
 * Fetch the current Skattekonto balance and recent transactions.
 */
export const fetchSkattekonto = async (orgNumber: string): Promise<SkattekontoResponse> => {
  const clean = orgNumber.replace(/[-\s]/g, "");
  return skvRequest<SkattekontoResponse>({
    method: "GET",
    path: `/skattekonto/v1/${encodeURIComponent(clean)}`
  });
};

/**
 * Return the balance in SEK (decimal).
 * Positive = overpaid (credit). Negative = owed.
 */
export const getSkattekontoBalanceSEK = async (orgNumber: string): Promise<number> => {
  const account = await fetchSkattekonto(orgNumber);
  return account.saldo / 100;
};
