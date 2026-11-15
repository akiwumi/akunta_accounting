/**
 * The NE-bilaga as flat rows for the Excel/PDF exports and the reports API.
 *
 * One source of truth: every export uses the same computation as the guided
 * year-end at /year-end (lib/tax/neBilaga.ts), including the figures the user
 * has entered there. The NE-bilaga always covers a whole calendar year, so the
 * year is taken from the end of the requested period.
 */

import { prisma } from "@/lib/db";
import { buildNeBilaga, type NeBilaga } from "@/lib/tax/neBilaga";
import { neBoxNumber, neBoxText } from "@/lib/tax/neTexts";
import { getYearEndInputs } from "@/lib/tax/neYearEnd";
import { birthYearFromPersonnummer } from "@/lib/tax/sru";

export type NeRow = { Section: string; Line: string; Amount: number | string };

const SECTION_LABEL: Record<string, string> = {
  balance: "Balansräkning",
  income: "Resultaträkning",
  adjustments: "Skattemässiga justeringar",
  other: "Övriga uppgifter"
};

export const buildNeForPeriod = async (businessId: string, periodEnd: Date): Promise<NeBilaga> => {
  const year = periodEnd.getUTCFullYear();
  const [business, inputs] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { vatRegistered: true, personnummer: true }
    }),
    getYearEndInputs(businessId, year)
  ]);

  return buildNeBilaga(businessId, year, {
    manual: inputs.manual,
    birthYear: birthYearFromPersonnummer(inputs.submitter.personnummer || business?.personnummer),
    vatRegistered: business?.vatRegistered ?? true
  });
};

export const neRows = (ne: NeBilaga): NeRow[] => [
  { Section: "Inkomstår", Line: `${ne.periodStart} – ${ne.periodEnd}`, Amount: ne.incomeYear },
  ...ne.boxes.map((box) => ({
    Section: SECTION_LABEL[box.section] ?? box.section,
    Line: `${neBoxNumber(box.id)} ${neBoxText(box.id, "sv").label}`,
    // A box the app cannot compute is shown as such, never as zero.
    Amount: box.amount === null ? "Fyll i själv" : box.amount
  })),
  {
    Section: "Resultat",
    Line: ne.result >= 0 ? "R47 Överskott" : "R48 Underskott",
    Amount: Math.abs(ne.result)
  }
];

export const buildNeRows = async (businessId: string, periodEnd: Date): Promise<NeRow[]> =>
  neRows(await buildNeForPeriod(businessId, periodEnd));
