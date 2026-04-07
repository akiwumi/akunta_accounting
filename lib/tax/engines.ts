import { euTemplateTaxEngine } from "@/lib/tax/eu-template";
import { swedenTaxEngine } from "@/lib/tax/sweden";
import type { TaxEngine } from "@/lib/tax/types";
import { ukTemplateTaxEngine } from "@/lib/tax/uk-template";
import { Jurisdictions, type Jurisdiction } from "@/lib/domain/enums";
import { estimateWithProfile, type CountryTaxProfileRow } from "@/lib/tax/profileEngine";

/**
 * Legacy jurisdiction-based engine selector.
 * Used as fallback when no CountryTaxProfile has been applied.
 */
export const getTaxEngine = (jurisdiction: Jurisdiction): TaxEngine => {
  if (jurisdiction === Jurisdictions.SWEDEN) return swedenTaxEngine;
  if (jurisdiction === Jurisdictions.UK) return ukTemplateTaxEngine;
  return euTemplateTaxEngine;
};

/**
 * Profile-aware engine selector.
 * If a CountryTaxProfile is available for the business, it takes precedence
 * over the legacy jurisdiction-based engines.
 *
 * Usage in /api/reports/tax-estimate:
 *   const result = await resolveAndEstimate(pnl.operatingProfit, business, countryTaxProfile);
 */
export function resolveAndEstimate(
  profitBeforeTax: number,
  business: { jurisdiction: string; taxConfig?: { municipalTaxRate: unknown; socialContributionRate: unknown; generalDeductionRate: unknown } | null },
  countryTaxProfile: CountryTaxProfileRow | null
) {
  if (countryTaxProfile) {
    return {
      engine: `${countryTaxProfile.countryCode} (profile)`,
      ...estimateWithProfile(profitBeforeTax, countryTaxProfile)
    };
  }

  // Legacy path
  const legacyEngine = getTaxEngine(business.jurisdiction as Jurisdiction);
  const taxConfig = business.taxConfig;
  if (!taxConfig) throw new Error("Missing tax configuration.");

  const result = legacyEngine.estimate({
    profitBeforeTax,
    municipalTaxRate: parseFloat(String(taxConfig.municipalTaxRate)),
    socialContributionRate: parseFloat(String(taxConfig.socialContributionRate)),
    generalDeductionRate: parseFloat(String(taxConfig.generalDeductionRate))
  });

  return { engine: legacyEngine.label, ...result };
}
