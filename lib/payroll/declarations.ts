/**
 * Arbetsgivardeklaration (AGD) — employer monthly payroll declaration.
 *
 * Aggregates all approved/paid salary entries for a given year+month,
 * builds the declaration payload, and persists it as an EmployerDeclaration.
 *
 * Submission to Skatteverket is handled by lib/integrations/skatteverket/arbetsgivardeklaration.ts.
 */

import { prisma } from "@/lib/db";
import { asNumber, round2 } from "@/lib/accounting/math";

export type DeclarationLine = {
  employeeId: string;
  employeeName: string;
  personalNumber: string;
  taxableGross: number;
  taxWithheld: number;
  employerContrib: number;
};

export type DeclarationPayload = {
  businessId: string;
  orgNumber: string;
  periodYear: number;
  periodMonth: number;
  lines: DeclarationLine[];
  totals: {
    totalGross: number;
    totalTax: number;
    totalContrib: number;
  };
};

export const buildDeclaration = async (
  businessId: string,
  year: number,
  month: number
): Promise<DeclarationPayload> => {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error("Business not found.");

  const orgNumber = business.personnummer ?? business.vatNumber ?? business.skvActorId ?? "";

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const entries = await prisma.salaryEntry.findMany({
    where: {
      businessId,
      payrollDate: { gte: periodStart, lte: periodEnd },
      status: { in: ["APPROVED", "PAID"] }
    },
    include: { employee: true }
  });

  const lines: DeclarationLine[] = entries.map((e) => ({
    employeeId: e.employeeId,
    employeeName: `${e.employee.firstName} ${e.employee.lastName}`,
    personalNumber: e.employee.personalNumber,
    taxableGross: asNumber(e.taxableGross),
    taxWithheld: asNumber(e.preliminaryTaxAmount),
    employerContrib: asNumber(e.employerContributionAmount)
  }));

  const totalGross = round2(lines.reduce((s, l) => s + l.taxableGross, 0));
  const totalTax = round2(lines.reduce((s, l) => s + l.taxWithheld, 0));
  const totalContrib = round2(lines.reduce((s, l) => s + l.employerContrib, 0));

  return {
    businessId,
    orgNumber,
    periodYear: year,
    periodMonth: month,
    lines,
    totals: { totalGross, totalTax, totalContrib }
  };
};

export const saveDeclarationDraft = async (
  businessId: string,
  year: number,
  month: number
): Promise<string> => {
  const payload = await buildDeclaration(businessId, year, month);

  const decl = await prisma.employerDeclaration.upsert({
    where: { businessId_periodYear_periodMonth: { businessId, periodYear: year, periodMonth: month } },
    create: {
      businessId,
      periodYear: year,
      periodMonth: month,
      status: "DRAFT",
      totalGross: payload.totals.totalGross,
      totalTax: payload.totals.totalTax,
      totalContrib: payload.totals.totalContrib,
      payloadJson: JSON.stringify(payload)
    },
    update: {
      status: "DRAFT",
      totalGross: payload.totals.totalGross,
      totalTax: payload.totals.totalTax,
      totalContrib: payload.totals.totalContrib,
      payloadJson: JSON.stringify(payload)
    }
  });

  return decl.id;
};
