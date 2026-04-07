/**
 * Arbetsgivardeklaration — Skatteverket employer declaration filing API.
 *
 * Used when payroll reaches filing-grade completeness.
 * Each monthly declaration covers all employees' preliminary tax and employer contributions.
 */

import { skvRequest } from "./client";
import type { DeclarationPayload } from "@/lib/payroll/declarations";

export type AgdSubmissionResponse = {
  referenceId: string;
  status: string;
  receivedAt?: string;
};

export type AgdStatusResponse = {
  referenceId: string;
  status: "RECEIVED" | "PROCESSING" | "ACCEPTED" | "REJECTED";
  detail?: string;
};

type AgdEmployee = {
  personnummer: string;
  namn: string;
  bruttolön: number;       // SEK öre
  preliminärskatt: number; // SEK öre
  arbetsgivaravgift: number; // SEK öre
};

type AgdPayload = {
  organisationsnummer: string;
  period: string;           // YYYYMM
  anställda: AgdEmployee[];
  totalt: {
    bruttolön: number;
    preliminärskatt: number;
    arbetsgivaravgift: number;
  };
};

const toOre = (sek: number) => Math.round(sek * 100);

export const buildAgdPayload = (declaration: DeclarationPayload): AgdPayload => ({
  organisationsnummer: declaration.orgNumber.replace(/[-\s]/g, ""),
  period: `${declaration.periodYear}${String(declaration.periodMonth).padStart(2, "0")}`,
  anställda: declaration.lines.map((l) => ({
    personnummer: l.personalNumber.replace(/[-\s]/g, ""),
    namn: l.employeeName,
    bruttolön: toOre(l.taxableGross),
    preliminärskatt: toOre(l.taxWithheld),
    arbetsgivaravgift: toOre(l.employerContrib)
  })),
  totalt: {
    bruttolön: toOre(declaration.totals.totalGross),
    preliminärskatt: toOre(declaration.totals.totalTax),
    arbetsgivaravgift: toOre(declaration.totals.totalContrib)
  }
});

export const submitArbetsgivardeklaration = async (
  declaration: DeclarationPayload
): Promise<AgdSubmissionResponse> => {
  const payload = buildAgdPayload(declaration);
  return skvRequest<AgdSubmissionResponse>({
    method: "POST",
    path: "/arbetsgivardeklaration/v1/inkommer",
    body: payload
  });
};

export const getArbetsgivardeklarationStatus = async (
  referenceId: string
): Promise<AgdStatusResponse> => {
  return skvRequest<AgdStatusResponse>({
    method: "GET",
    path: `/arbetsgivardeklaration/v1/status/${encodeURIComponent(referenceId)}`
  });
};
