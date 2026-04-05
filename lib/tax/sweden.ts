import { round2 } from "@/lib/accounting/math";
import type { TaxEngine, TaxEstimateInput } from "@/lib/tax/types";

const estimateSwedishSoleTraderTax = (input: TaxEstimateInput) => {
  const profitBeforeTax = Math.max(0, round2(input.profitBeforeTax));
  const socialContributions = round2(profitBeforeTax * input.socialContributionRate);
  const deductionForContributions = round2(socialContributions * input.generalDeductionRate);
  const taxableIncome = Math.max(0, round2(profitBeforeTax - deductionForContributions));
  const incomeTax = round2(taxableIncome * input.municipalTaxRate);
  const totalEstimatedTax = round2(incomeTax + socialContributions);

  return {
    profitBeforeTax,
    estimatedSocialContributions: socialContributions,
    deductionForContributions,
    taxableIncome,
    estimatedIncomeTax: incomeTax,
    totalEstimatedTax,
    notes: [
      "Projection for Swedish sole trader tax and social contributions.",
      "Rates are configurable and should be reviewed yearly before filing."
    ]
  };
};

export const swedenTaxEngine: TaxEngine = {
  id: "SE",
  label: "Sweden (Sole Trader)",
  estimate: estimateSwedishSoleTraderTax
};
