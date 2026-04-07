/**
 * Country tax profile template definition.
 * Each country has one template; businesses get a copy (CountryTaxProfile row)
 * that can be overridden per-business without mutating the template.
 */

export type IncomeTaxBandDef = {
  bandOrder: number;
  fromAmount: number;
  toAmount: number | null; // null = unlimited
  rate: number;
  label?: string;
};

export type CountryProfileTemplate = {
  /** ISO 3166-1 alpha-2 */
  countryCode: string;
  countryName: string;
  templateFamily: string;
  templateVersion: string;

  // VAT
  vatStandardRate: number;
  vatReducedRate1?: number;
  vatReducedRate2?: number;
  vatReducedRate3?: number;
  vatRegistrationThreshold?: number;
  vatCashAccounting: boolean;
  ossEnabled: boolean;
  reverseChargeEnabled: boolean;

  // Filing periods
  taxYearStartMonth: number;
  taxYearEndMonth: number;
  vatFilingFrequency: "monthly" | "quarterly" | "yearly";
  vatPaymentDueDays: number;

  // Direct tax
  incomeTaxMode: "progressive" | "flat";
  incomeTaxBands: IncomeTaxBandDef[];
  flatIncomeTaxRate?: number;
  municipalSurchargeRate?: number;
  nationalSurchargeRate?: number;
  nationalSurchargeThreshold?: number;

  // Social / self-employed contributions
  socialContributionRate: number;
  socialContributionCap?: number;
  pensionContributionRate: number;
  pensionContributionCap?: number;
  generalDeductionRate: number;

  // Payroll
  employerContributionRate: number;
  employeeWithholdingRate: number;

  // UI labels
  personalTaxIdLabel: string;
  businessRegIdLabel: string;
  vatIdLabel: string;
  socialContribLabel: string;

  // Notes shown in settings UI
  notes?: string[];
};
