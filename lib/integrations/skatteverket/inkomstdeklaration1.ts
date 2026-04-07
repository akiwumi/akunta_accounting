/**
 * Inkomstdeklaration 1 (ID1) — data preparation for Swedish sole traders.
 *
 * ID1 is the annual income tax return for physical persons and sole traders
 * (enskild firma). This module assembles the key boxes from the ledger data
 * already in Akunta and stores a draft Filing record.
 *
 * The Swedish Skatteverket public API for ID1 electronic filing is not yet
 * generally available. This module:
 *   1. Computes all reportable figures from the NE-bilaga draft.
 *   2. Stores a structured draft as a Filing record (payloadJson).
 *   3. Returns the draft payload so the UI can render a prefilled form for
 *      the user to review before submitting through Skatteverkets e-tjänst.
 *
 * Box references follow Skatteverkets Inkomstdeklaration 1 form (latest edition).
 */

import { round2 } from "@/lib/accounting/math";
import { buildNeBilagaDraft } from "@/lib/accounting/reports";
import { prisma } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Id1NeBilaga {
  /** R10 Nettoomsättning */
  R10_nettoomsattning: number;
  /** R2 Bidrag och försäkringsersättning */
  R2_bidragForsäkring: number;
  /** R4 Ränteintäkter */
  R4_ranteintakter: number;
  /** R5 Vinst avyttring inventarier */
  R5_vinstAvyttring: number;
  /** R16 Varor och material */
  R16_varorMaterial: number;
  /** R17 Övriga externa kostnader */
  R17_externaKostnader: number;
  /** R18 Personalkostnader */
  R18_personalkostnader: number;
  /** R20 Avskrivningar */
  R20_avskrivningar: number;
  /** R21 Förlust avyttring inventarier */
  R21_forlusAvyttring: number;
  /** R22 Egenavgifter / arbetsgivaravgifter */
  R22_socialContributions: number;
  /** R23 Övriga kostnader */
  R23_ovrigaKostnader: number;
  /** Periodiseringsfond withdrawal (increases taxable income) */
  perisFondWithdrawal: number;
  /** Periodiseringsfond allocation (decreases taxable income, max 30% of R47) */
  perisFondAllocation: number;
  /** Expansionsfond withdrawal */
  expFondWithdrawal: number;
  /** Expansionsfond allocation */
  expFondAllocation: number;
  /** R47 Redovisat resultat (accounting result before tax adjustments) */
  R47_redovisatResultat: number;
  /** R48 Taxable result after adjustments */
  R48_taxableResult: number;
  /** Mileage deduction */
  mileageDeduction: number;
}

export interface Id1TaxEstimate {
  /** Taxable income from business (box 10.1 if positive) */
  inkomstNäringsverksamhet: number;
  /** Deficit from business (box 10.2 if negative) */
  underskottNäringsverksamhet: number;
  /** Preliminary tax estimate (municipal + state + egenavgifter) */
  preliminaryTaxEstimateSEK: number;
  /** Self-employment contributions (egenavgifter) */
  egenavgifterSEK: number;
  /** General deduction from egenavgifter (allmänt avdrag) */
  allmanAvdragSEK: number;
}

export interface Id1Draft {
  taxYear: number;
  filingYear: number;
  /** Skatteverket form deadlines */
  deadlines: {
    paperDeadline: string;   // YYYY-MM-DD
    digitalDeadline: string; // YYYY-MM-DD
  };
  /** Business identity */
  personnummer?: string;
  businessName: string;
  /** NE-bilaga figures */
  neBilaga: Id1NeBilaga;
  /** Top-level ID1 boxes derived from NE */
  taxBoxes: Id1TaxEstimate;
  /** Filing record id if saved */
  filingId?: string;
  /** ISO timestamp when draft was prepared */
  preparedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Prepare an Inkomstdeklaration 1 draft for the given tax year.
 *
 * @param businessId  The business to prepare the declaration for.
 * @param taxYear     The tax year being declared (e.g. 2024).
 * @param save        If true, upserts a Filing record of type "ID1" with status "DRAFT".
 */
export async function prepareId1Draft(
  businessId: string,
  taxYear: number,
  save = true
): Promise<Id1Draft> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { taxConfig: true },
  });

  const yearStart = new Date(Date.UTC(taxYear, 0, 1));
  const yearEnd   = new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999));

  // ── NE-bilaga data ─────────────────────────────────────────────────────────
  const ne = await buildNeBilagaDraft({ businessId, from: yearStart, to: yearEnd });

  const neBilaga: Id1NeBilaga = {
    R10_nettoomsattning:     asNum(ne.incomeLines?.R10_nettoomsattning),
    R2_bidragForsäkring:     asNum(ne.incomeLines?.R2_bidragForsäkringsersättning),
    R4_ranteintakter:        asNum(ne.incomeLines?.R4_ranteintakter),
    R5_vinstAvyttring:       asNum(ne.incomeLines?.R5_vinstAvyttringInventarier),
    R16_varorMaterial:       asNum(ne.expenseLines?.R16_varorMaterial),
    R17_externaKostnader:    asNum(ne.expenseLines?.R17_ovrigaExternaKostnader),
    R18_personalkostnader:   asNum(ne.expenseLines?.R18_personalkostnader),
    R20_avskrivningar:       asNum(ne.expenseLines?.R20_avskrivningar),
    R21_forlusAvyttring:     asNum(ne.expenseLines?.R21_forlusAvyttringInventarier),
    R22_socialContributions: asNum(ne.expenseLines?.R22_egenavgifterArbetsgivaravgifter),
    R23_ovrigaKostnader:     asNum(ne.expenseLines?.R23_ovrigaKostnader),
    perisFondWithdrawal:     asNum(ne.taxAdjustments?.perisFond_withdrawal),
    perisFondAllocation:     asNum(ne.taxAdjustments?.perisFond_allocation),
    expFondWithdrawal:       asNum(ne.taxAdjustments?.expFond_withdrawal),
    expFondAllocation:       asNum(ne.taxAdjustments?.expFond_allocation),
    R47_redovisatResultat:   asNum(ne.R47_overskottUnderskott),
    R48_taxableResult:       asNum(ne.R48_skattemassigResultat),
    mileageDeduction:        asNum(ne.supplementary?.mileageDeduction),
  };

  // ── Tax estimate ───────────────────────────────────────────────────────────
  const taxableIncome = neBilaga.R48_taxableResult;

  const socialRate   = business.taxConfig ? asNum(business.taxConfig.socialContributionRate) : 0.2897;
  const municipalRate = business.taxConfig ? asNum(business.taxConfig.municipalTaxRate)       : 0.32;
  const deductRate    = business.taxConfig ? asNum(business.taxConfig.generalDeductionRate)    : 0.25;

  // Egenavgifter base: max 97% of taxable income (Skatteverket rule)
  const egenavgifterBase = round2(Math.max(0, taxableIncome) * 0.97);
  const egenavgifterSEK  = round2(egenavgifterBase * socialRate);

  // Allmänt avdrag: 25% of egenavgifter
  const allmanAvdragSEK = round2(egenavgifterSEK * deductRate);

  // Taxable income after deductions
  const adjustedIncome = round2(Math.max(0, taxableIncome - egenavgifterSEK * 0.5 - allmanAvdragSEK));

  // Municipal tax only (simplified; state tax applies above ~616,100 SEK in 2024)
  const stateTaxThreshold = 598_500; // approximate 2024 state income tax threshold
  const stateTaxRate      = 0.20;
  const stateTaxablePart  = Math.max(0, adjustedIncome - stateTaxThreshold);

  const municipalTax = round2(adjustedIncome * municipalRate);
  const stateTax     = round2(stateTaxablePart * stateTaxRate);
  const preliminaryTaxEstimateSEK = round2(municipalTax + stateTax + egenavgifterSEK);

  const taxBoxes: Id1TaxEstimate = {
    inkomstNäringsverksamhet:    taxableIncome > 0 ? taxableIncome : 0,
    underskottNäringsverksamhet: taxableIncome < 0 ? Math.abs(taxableIncome) : 0,
    preliminaryTaxEstimateSEK,
    egenavgifterSEK,
    allmanAvdragSEK,
  };

  const filingYear  = taxYear + 1;
  const preparedAt  = new Date().toISOString();

  const draft: Id1Draft = {
    taxYear,
    filingYear,
    deadlines: {
      paperDeadline:   `${filingYear}-05-04`,
      digitalDeadline: `${filingYear}-05-02`,
    },
    personnummer:  business.personnummer ?? undefined,
    businessName:  business.name,
    neBilaga,
    taxBoxes,
    preparedAt,
  };

  // ── Persist as Filing ──────────────────────────────────────────────────────
  if (save) {
    const existing = await prisma.filing.findFirst({
      where: { businessId, filingType: "ID1", periodStart: yearStart, periodEnd: yearEnd },
    });

    const payloadJson = JSON.stringify(draft);

    if (existing) {
      await prisma.filing.update({
        where: { id: existing.id },
        data: { payloadJson, updatedAt: new Date() },
      });
      draft.filingId = existing.id;
    } else {
      const filing = await prisma.filing.create({
        data: {
          businessId,
          filingType: "ID1",
          periodStart: yearStart,
          periodEnd:   yearEnd,
          status:      "DRAFT",
          payloadJson,
        },
      });
      draft.filingId = filing.id;
    }
  }

  return draft;
}
