/**
 * Beskattningsengagemang — Skatteverket registration status API.
 *
 * Use for:
 *  - Onboarding: verify the organisation number is registered
 *  - F-skatt status check
 *  - VAT registration status
 *  - Employer registration status
 *
 * Docs: https://www.skatteverket.se/foretag/myndigheterochorganisationer/apierfortjansterorochverksamhetssystem
 */

import { skvRequest } from "./client";

export type BeskattningsengagemangResult = {
  organisationsnummer: string;
  fSkattRegistrerad: boolean;
  momsregistrerad: boolean;
  arbetsgivareRegistrerad: boolean;
  namn?: string;
  adress?: string;
  postnummer?: string;
  ort?: string;
  registreringsdatum?: string;
};

export type BeskattningsengagemangResponse = {
  found: boolean;
  data: BeskattningsengagemangResult | null;
  rawResponse?: unknown;
};

/**
 * Look up registration status by organisation number (10 digits, no dashes).
 */
export const fetchBeskattningsengagemang = async (
  orgNumber: string
): Promise<BeskattningsengagemangResponse> => {
  const clean = orgNumber.replace(/[-\s]/g, "");

  const data = await skvRequest<BeskattningsengagemangResult>({
    method: "GET",
    path: `/beskattningsengagemang/v1/${encodeURIComponent(clean)}`
  });

  return { found: true, data };
};

/**
 * Check if an organisation has active F-skatt.
 */
export const hasFSkatt = async (orgNumber: string): Promise<boolean> => {
  try {
    const result = await fetchBeskattningsengagemang(orgNumber);
    return result.data?.fSkattRegistrerad ?? false;
  } catch {
    return false;
  }
};
