import { euTemplateTaxEngine } from "@/lib/tax/eu-template";
import { swedenTaxEngine } from "@/lib/tax/sweden";
import type { TaxEngine } from "@/lib/tax/types";
import { ukTemplateTaxEngine } from "@/lib/tax/uk-template";
import { Jurisdictions, type Jurisdiction } from "@/lib/domain/enums";

export const getTaxEngine = (jurisdiction: Jurisdiction): TaxEngine => {
  if (jurisdiction === Jurisdictions.SWEDEN) return swedenTaxEngine;
  if (jurisdiction === Jurisdictions.UK) return ukTemplateTaxEngine;
  return euTemplateTaxEngine;
};
