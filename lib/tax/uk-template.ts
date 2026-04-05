import type { TaxEngine } from "@/lib/tax/types";

export const ukTemplateTaxEngine: TaxEngine = {
  id: "UK",
  label: "United Kingdom Template",
  estimate: (input) => {
    const taxableIncome = Math.max(0, input.profitBeforeTax);
    const estimatedIncomeTax = taxableIncome * input.municipalTaxRate;
    const estimatedSocialContributions = taxableIncome * input.socialContributionRate;
    return {
      profitBeforeTax: taxableIncome,
      estimatedSocialContributions,
      deductionForContributions: 0,
      taxableIncome,
      estimatedIncomeTax,
      totalEstimatedTax: estimatedIncomeTax + estimatedSocialContributions,
      notes: [
        "UK template engine is intentionally generic.",
        "Replace with UK HMRC-specific rules before production filing."
      ]
    };
  }
};
