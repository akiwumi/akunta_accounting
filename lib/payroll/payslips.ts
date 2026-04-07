/**
 * Payslip generation.
 *
 * Builds a structured payslip data object from a SalaryEntry and its Employee.
 * PDF rendering uses the same lightweight approach as invoice PDFs.
 * The generated PDF is stored via lib/storage/receipts pattern.
 */

import { prisma } from "@/lib/db";
import { asNumber, round2 } from "@/lib/accounting/math";
import { storeInvoicePdf } from "@/lib/storage/invoices";

export type PayslipData = {
  payslipId: string;
  employeeName: string;
  personalNumber: string;
  employerName: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  grossSalary: number;
  bonusAmount: number;
  overtimeAmount: number;
  benefitsAmount: number;
  taxableGross: number;
  preliminaryTaxRate: number;
  taxWithheld: number;
  employerContribRate: number;
  employerContrib: number;
  pensionRate: number;
  pensionAmount: number;
  netSalary: number;
  totalEmployerCost: number;
};

export const buildPayslipData = async (
  salaryEntryId: string,
  businessId: string
): Promise<PayslipData> => {
  const entry = await prisma.salaryEntry.findFirst({
    where: { id: salaryEntryId, businessId },
    include: { employee: true }
  });
  if (!entry) throw new Error(`Salary entry ${salaryEntryId} not found.`);

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error("Business not found.");

  const gross = asNumber(entry.grossSalary);
  const bonus = asNumber(entry.bonusAmount);
  const overtime = asNumber(entry.overtimeAmount);
  const benefits = asNumber(entry.benefitsAmount);
  const taxableGross = asNumber(entry.taxableGross);
  const taxWithheld = asNumber(entry.preliminaryTaxAmount);
  const taxRate = asNumber(entry.preliminaryTaxRate);
  const contribRate = asNumber(entry.employerContributionRate);
  const contrib = asNumber(entry.employerContributionAmount);
  const pensionRate = asNumber(entry.pensionRate);
  const pension = asNumber(entry.pensionAmount);
  const net = asNumber(entry.netSalary);

  return {
    payslipId: salaryEntryId,
    employeeName: `${entry.employee.firstName} ${entry.employee.lastName}`,
    personalNumber: entry.employee.personalNumber,
    employerName: business.name,
    periodFrom: (entry.periodFrom ?? entry.payrollDate).toISOString().slice(0, 10),
    periodTo: (entry.periodTo ?? entry.payrollDate).toISOString().slice(0, 10),
    paymentDate: entry.payrollDate.toISOString().slice(0, 10),
    grossSalary: gross,
    bonusAmount: bonus,
    overtimeAmount: overtime,
    benefitsAmount: benefits,
    taxableGross,
    preliminaryTaxRate: taxRate,
    taxWithheld,
    employerContribRate: contribRate,
    employerContrib: contrib,
    pensionRate,
    pensionAmount: pension,
    netSalary: net,
    totalEmployerCost: round2(taxableGross + contrib + pension)
  };
};

/** Generate a simple plain-text payslip and store it as a "PDF" key. */
export const generateAndStorePayslip = async (
  salaryEntryId: string,
  businessId: string
): Promise<{ payslipId: string; pdfKey: string }> => {
  const data = await buildPayslipData(salaryEntryId, businessId);

  // Build plain-text representation (swap for a real PDF lib when available)
  const text = formatPayslipText(data);
  const buffer = Buffer.from(text, "utf8");
  const key = `payslip-${salaryEntryId}.txt`;

  await storeInvoicePdf(buffer, key);

  // Upsert Payslip record
  await prisma.payslip.upsert({
    where: { salaryEntryId },
    create: {
      businessId,
      salaryEntryId,
      employeeId: (await prisma.salaryEntry.findUnique({ where: { id: salaryEntryId }, select: { employeeId: true } }))!.employeeId,
      periodFrom: new Date(`${data.periodFrom}T00:00:00.000Z`),
      periodTo: new Date(`${data.periodTo}T00:00:00.000Z`),
      paymentDate: new Date(`${data.paymentDate}T00:00:00.000Z`),
      grossSalary: data.grossSalary,
      taxableGross: data.taxableGross,
      taxWithheld: data.taxWithheld,
      employerContrib: data.employerContrib,
      pensionAmount: data.pensionAmount,
      netSalary: data.netSalary,
      pdfKey: key
    },
    update: { pdfKey: key }
  });

  return { payslipId: salaryEntryId, pdfKey: key };
};

const formatPayslipText = (d: PayslipData): string => `
LÖNESPECIFIKATION / PAYSLIP
============================
Arbetsgivare / Employer : ${d.employerName}
Anställd / Employee     : ${d.employeeName}
Personnummer            : ${d.personalNumber}
Löneperiod              : ${d.periodFrom} – ${d.periodTo}
Utbetalningsdag         : ${d.paymentDate}

INKOMST / EARNINGS
-------------------
Grundlön / Base salary  : ${fmt(d.grossSalary)} SEK
Bonus                   : ${fmt(d.bonusAmount)} SEK
Övertid / Overtime      : ${fmt(d.overtimeAmount)} SEK
Förmåner / Benefits     : ${fmt(d.benefitsAmount)} SEK
Bruttolön / Taxable     : ${fmt(d.taxableGross)} SEK

AVDRAG / DEDUCTIONS
--------------------
Prelskatt ${pct(d.preliminaryTaxRate)} : -${fmt(d.taxWithheld)} SEK

NETTOLÖN / NET PAY      : ${fmt(d.netSalary)} SEK

ARBETSGIVARAVGIFTER / EMPLOYER COSTS
--------------------------------------
Arbetsgivaravg ${pct(d.employerContribRate)} : ${fmt(d.employerContrib)} SEK
Pension ${pct(d.pensionRate)}         : ${fmt(d.pensionAmount)} SEK
Total kostnad            : ${fmt(d.totalEmployerCost)} SEK
============================
`;

const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
