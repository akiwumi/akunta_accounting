/**
 * Momsdeklaration (VAT return) — Skatteverket filing API.
 *
 * Use for:
 *  - Generating a VAT return draft from the ledger
 *  - Submitting VAT returns electronically
 *  - Retrieving submission status
 */

import { skvRequest } from "./client";

export type VatReturnPeriod = {
  from: string; // YYYY-MM-DD
  to: string;
};

export type VatReturnAmounts = {
  /** Total output VAT (utgående moms) in SEK öre */
  utgaendeMomsSEK: number;
  /** Total input VAT (ingående moms) in SEK öre */
  ingaendeMomsSEK: number;
  /** Net VAT payable: utgående - ingående */
  momsSEK: number;
  /** Taxable turnover (omsättning) */
  omsattningHogMomsSEK: number;
  omsattningMellanMomsSEK: number;
  omsattningLagMomsSEK: number;
};

export type VatReturnDraftPayload = {
  organisationsnummer: string;
  period: VatReturnPeriod;
  amounts: VatReturnAmounts;
};

export type VatReturnSubmissionResponse = {
  referenceId: string;
  status: string;
  receivedAt?: string;
};

export type VatReturnStatusResponse = {
  referenceId: string;
  status: "RECEIVED" | "PROCESSING" | "ACCEPTED" | "REJECTED";
  detail?: string;
};

/**
 * Submit a VAT return to Skatteverket.
 */
export const submitMomsdeklaration = async (
  payload: VatReturnDraftPayload
): Promise<VatReturnSubmissionResponse> => {
  return skvRequest<VatReturnSubmissionResponse>({
    method: "POST",
    path: "/momsdeklaration/v1/inkommer",
    body: payload
  });
};

/**
 * Retrieve the status of a submitted VAT return.
 */
export const getMomsdeklarationStatus = async (
  referenceId: string
): Promise<VatReturnStatusResponse> => {
  return skvRequest<VatReturnStatusResponse>({
    method: "GET",
    path: `/momsdeklaration/v1/status/${encodeURIComponent(referenceId)}`
  });
};

/**
 * Build the VAT return payload from pre-calculated report totals.
 * Amounts are passed in SEK (decimal), converted to öre for submission.
 */
export const buildVatReturnPayload = (
  orgNumber: string,
  period: VatReturnPeriod,
  vatReport: {
    outputVatSEK: number;
    inputVatSEK: number;
    salesHighVatSEK: number;
    salesMidVatSEK: number;
    salesLowVatSEK: number;
  }
): VatReturnDraftPayload => {
  const toOre = (sek: number) => Math.round(sek * 100);
  return {
    organisationsnummer: orgNumber.replace(/[-\s]/g, ""),
    period,
    amounts: {
      utgaendeMomsSEK: toOre(vatReport.outputVatSEK),
      ingaendeMomsSEK: toOre(vatReport.inputVatSEK),
      momsSEK: toOre(vatReport.outputVatSEK - vatReport.inputVatSEK),
      omsattningHogMomsSEK: toOre(vatReport.salesHighVatSEK),
      omsattningMellanMomsSEK: toOre(vatReport.salesMidVatSEK),
      omsattningLagMomsSEK: toOre(vatReport.salesLowVatSEK)
    }
  };
};
