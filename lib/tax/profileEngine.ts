/**
 * Profile-driven tax engine.
 *
 * Uses the business's CountryTaxProfile (DB row) to estimate tax.
 * Works for all 28 templates (27 EU + UK) — both flat and progressive modes.
 *
 * Output format matches TaxEstimateOutput so it's a drop-in replacement
 * for the existing country engines used by /api/reports/tax-estimate.
 */

import { round2 } from "@/lib/accounting/math";
import type { TaxEstimateOutput } from "@/lib/tax/types";

// Prisma returns Decimal objects for numeric fields — accept any numeric-like value
type DecimalLike = number | string | { toNumber(): number } | null;

export type IncomeTaxBandRow = {
  bandOrder: number | string | { toNumber(): number };
  fromAmount: DecimalLike;
  toAmount: DecimalLike;
  rate: DecimalLike;
  label: string | null;
};

export type CountryTaxProfileRow = {
  countryCode: string;
  incomeTaxMode: string; // "progressive" | "flat"
  flatIncomeTaxRate: DecimalLike;
  municipalSurchargeRate: DecimalLike;
  nationalSurchargeRate: DecimalLike;
  nationalSurchargeThreshold: DecimalLike;
  socialContributionRate: DecimalLike;
  socialContributionCap: DecimalLike;
  pensionContributionRate: DecimalLike;
  pensionContributionCap: DecimalLike;
  generalDeductionRate: DecimalLike;
  incomeTaxBands: IncomeTaxBandRow[];
};

const n = (v: DecimalLike | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && "toNumber" in v) return v.toNumber();
  if (typeof v === "string") return parseFloat(v);
  return v;
};

function applyProgressiveBands(
  income: number,
  bands: IncomeTaxBandRow[]
): { tax: number; breakdown: Array<{ label: string | null; amount: number; rate: number }> } {
  let tax = 0;
  const breakdown: Array<{ label: string | null; amount: number; rate: number }> = [];

  for (const band of [...bands].sort((a, b) => Number(a.bandOrder) - Number(b.bandOrder))) {
    const from = n(band.fromAmount);
    const to = band.toAmount !== null ? n(band.toAmount) : Infinity;
    const rate = n(band.rate);

    if (income <= from) continue;
    const taxable = round2(Math.min(income, to) - from);
    const bandTax = round2(taxable * rate);
    tax = round2(tax + bandTax);
    if (taxable > 0) breakdown.push({ label: band.label, amount: taxable, rate });
  }

  return { tax, breakdown };
}

export function estimateWithProfile(
  profitBeforeTax: number,
  profile: CountryTaxProfileRow
): TaxEstimateOutput {
  const profit = Math.max(0, round2(profitBeforeTax));

  // Social contributions (capped if cap defined)
  const socialRate = n(profile.socialContributionRate);
  const socialCap = profile.socialContributionCap != null ? n(profile.socialContributionCap) : null;
  const socialBase = socialCap !== null ? Math.min(profit, socialCap) : profit;
  const socialContribs = round2(socialBase * socialRate);

  // Pension contributions
  const pensionRate = n(profile.pensionContributionRate);
  const pensionCap = profile.pensionContributionCap != null ? n(profile.pensionContributionCap) : null;
  const pensionBase = pensionCap !== null ? Math.min(profit, pensionCap) : profit;
  const pensionContribs = round2(pensionBase * pensionRate);

  // General deduction (SE-style: deduct a % of social contributions from taxable income)
  const deductionRate = n(profile.generalDeductionRate);
  const deductionForContribs = round2(socialContribs * deductionRate);
  const taxableIncome = Math.max(0, round2(profit - deductionForContribs));

  // Income tax
  let incomeTax = 0;
  const notes: string[] = [];

  if (profile.incomeTaxMode === "progressive" && profile.incomeTaxBands.length > 0) {
    const { tax, breakdown } = applyProgressiveBands(taxableIncome, profile.incomeTaxBands);
    incomeTax = tax;
    for (const b of breakdown) {
      if (b.rate > 0) {
        notes.push(
          `${b.label ?? "Band"}: ${(b.rate * 100).toFixed(0)}% on ${round2(b.amount).toLocaleString("en-GB")}`
        );
      }
    }
  } else {
    const flatRate = n(profile.flatIncomeTaxRate);
    incomeTax = round2(taxableIncome * flatRate);
    notes.push(`Flat income tax rate: ${(flatRate * 100).toFixed(1)}%`);
  }

  // Municipal surcharge (applied on top of base income tax)
  const municipalRate = n(profile.municipalSurchargeRate);
  const municipalSurcharge = municipalRate > 0 ? round2(incomeTax * municipalRate) : 0;

  // National surcharge (applies above a threshold on the base income)
  const nationalRate = n(profile.nationalSurchargeRate);
  const nationalThreshold = profile.nationalSurchargeThreshold
    ? n(profile.nationalSurchargeThreshold)
    : null;
  let nationalSurcharge = 0;
  if (nationalRate > 0) {
    const surchargeBase = nationalThreshold
      ? Math.max(0, taxableIncome - nationalThreshold)
      : taxableIncome;
    nationalSurcharge = round2(surchargeBase * nationalRate);
    if (nationalSurcharge > 0) {
      notes.push(
        `National surcharge: ${(nationalRate * 100).toFixed(1)}% above ${nationalThreshold?.toLocaleString("en-GB") ?? "0"}`
      );
    }
  }

  const totalIncomeTax = round2(incomeTax + municipalSurcharge + nationalSurcharge);
  const totalTax = round2(totalIncomeTax + socialContribs + pensionContribs);

  notes.push(
    `Social contributions: ${(socialRate * 100).toFixed(2)}%`,
    `Country: ${profile.countryCode} (${profile.incomeTaxMode} mode)`
  );

  return {
    profitBeforeTax: profit,
    estimatedSocialContributions: round2(socialContribs + pensionContribs),
    deductionForContributions: deductionForContribs,
    taxableIncome,
    estimatedIncomeTax: totalIncomeTax,
    totalEstimatedTax: totalTax,
    notes
  };
}
