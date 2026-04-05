export type TaxEstimateInput = {
  profitBeforeTax: number;
  municipalTaxRate: number;
  socialContributionRate: number;
  generalDeductionRate: number;
};

export type TaxEstimateOutput = {
  profitBeforeTax: number;
  estimatedSocialContributions: number;
  deductionForContributions: number;
  taxableIncome: number;
  estimatedIncomeTax: number;
  totalEstimatedTax: number;
  notes: string[];
};

export type TaxEngine = {
  id: string;
  label: string;
  estimate: (input: TaxEstimateInput) => TaxEstimateOutput;
};
