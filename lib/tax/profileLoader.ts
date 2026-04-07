/**
 * Profile loader — applies a country template to a business.
 *
 * Creates or fully replaces the business's CountryTaxProfile row,
 * including income tax bands. Uses a transaction so partial writes
 * never leave the DB in an inconsistent state.
 *
 * Usage:
 *   await applyCountryTemplate(prisma, businessId, "DE");
 *   await applyCountryTemplate(prisma, businessId, "GB");
 */

import { prisma } from "@/lib/db";
import { getCountryProfile } from "@/lib/tax/profiles";
import type { CountryProfileTemplate } from "@/lib/tax/profiles/types";

export type ApplyTemplateResult = {
  ok: boolean;
  profileId?: string;
  error?: string;
};

/**
 * Apply a country template to a business.
 * Idempotent: calling again with the same code re-applies the template,
 * resetting any per-business overrides made since the last apply.
 */
export async function applyCountryTemplate(
  businessId: string,
  countryCode: string
): Promise<ApplyTemplateResult> {
  const template = getCountryProfile(countryCode);
  if (!template) {
    return { ok: false, error: `No template found for country code "${countryCode}".` };
  }

  try {
    const profile = await prisma.$transaction(async (tx) => {
      // Delete existing profile + bands (cascade will handle bands via relation)
      await tx.countryTaxProfile.deleteMany({ where: { businessId } });

      const created = await tx.countryTaxProfile.create({
        data: buildProfileData(businessId, template)
      });

      // Update Business.countryCode + resolution metadata
      await tx.business.update({
        where: { id: businessId },
        data: {
          countryCode: countryCode.toUpperCase(),
          countryResolutionSource: "explicit",
          taxProfileTemplateVersion: template.templateVersion,
          lastCountryConfirmedAt: new Date()
        }
      });

      return created;
    });

    return { ok: true, profileId: profile.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error applying template."
    };
  }
}

/**
 * Get the active country tax profile for a business.
 * Returns null if no profile has been applied yet.
 */
export async function getBusinessTaxProfile(businessId: string) {
  return prisma.countryTaxProfile.findUnique({
    where: { businessId },
    include: { incomeTaxBands: { orderBy: { bandOrder: "asc" } } }
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildProfileData(businessId: string, t: CountryProfileTemplate) {
  return {
    businessId,
    countryCode: t.countryCode,
    templateFamily: t.templateFamily,
    templateVersion: t.templateVersion,
    vatStandardRate: t.vatStandardRate,
    vatReducedRate1: t.vatReducedRate1 ?? null,
    vatReducedRate2: t.vatReducedRate2 ?? null,
    vatReducedRate3: t.vatReducedRate3 ?? null,
    vatRegistrationThreshold: t.vatRegistrationThreshold ?? null,
    vatCashAccounting: t.vatCashAccounting,
    ossEnabled: t.ossEnabled,
    reverseChargeEnabled: t.reverseChargeEnabled,
    taxYearStartMonth: t.taxYearStartMonth,
    taxYearEndMonth: t.taxYearEndMonth,
    vatFilingFrequency: t.vatFilingFrequency,
    vatPaymentDueDays: t.vatPaymentDueDays,
    incomeTaxMode: t.incomeTaxMode,
    flatIncomeTaxRate: t.flatIncomeTaxRate ?? null,
    municipalSurchargeRate: t.municipalSurchargeRate ?? null,
    nationalSurchargeRate: t.nationalSurchargeRate ?? null,
    nationalSurchargeThreshold: t.nationalSurchargeThreshold ?? null,
    socialContributionRate: t.socialContributionRate,
    socialContributionCap: t.socialContributionCap ?? null,
    pensionContributionRate: t.pensionContributionRate,
    pensionContributionCap: t.pensionContributionCap ?? null,
    generalDeductionRate: t.generalDeductionRate,
    employerContributionRate: t.employerContributionRate,
    employeeWithholdingRate: t.employeeWithholdingRate,
    personalTaxIdLabel: t.personalTaxIdLabel,
    businessRegIdLabel: t.businessRegIdLabel,
    vatIdLabel: t.vatIdLabel,
    socialContribLabel: t.socialContribLabel,
    incomeTaxBands: {
      create: t.incomeTaxBands.map((b) => ({
        bandOrder: b.bandOrder,
        fromAmount: b.fromAmount,
        toAmount: b.toAmount ?? null,
        rate: b.rate,
        label: b.label ?? null
      }))
    }
  };
}
