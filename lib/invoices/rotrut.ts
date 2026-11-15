/**
 * ROT and RUT (rotavdrag, rutavdrag): the customer pays the invoice minus a
 * preliminary tax reduction, and the business requests the rest from
 * Skatteverket. Pure rules with no database and no React, so the form, the
 * PDF, the routes and the tests all use the same numbers.
 *
 * Sources (read 2026-11-15):
 * - Rates and caps: inkomstskattelagen (1999:1229) 67 kap. 19 §, with the
 *   transitional provisions SFS 2024:415, 2024:418, 2025:321 and 2025:322.
 *   https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/inkomstskattelag-19991229_sfs-1999-1229/
 *   Skatteverket: https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut/safungerarrotavdraget.4.2ef18e6a125660db8b080002709.html
 *   and .../rotochrut/safungerarrutavdraget.4.64a656d113f4c7597011e41.html
 *   The customer's payment date decides the rate and the year.
 * - Basis: labour including VAT only. 67 kap. 18 § IL: material, equipment
 *   and travel are not included.
 * - Payout: lag (2009:194) om förfarandet vid skattereduktion för
 *   hushållsarbete, 7 to 9 a §§. The work must be done and paid, the request
 *   must reach Skatteverket by 31 January the year after the payment.
 * - File format: "XML version 1.0" and "1.1" for the e-service Rot och rut -
 *   företag. https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml/rotochrutforetag.4.71004e4c133e23bf6db800063583.html
 *   Schemas: https://xmls.skatteverket.se/se/skatteverket/skattered/begaran/V1/Begaran.xsd
 *   and .../begaran/V1.1/Begaran.xsd (1.1 is for requests from 1 January 2027).
 *   Import rules: https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/schemalagerxml/rotochrutforetag/reglerforattimporterafiltillrotochrut.4.76a43be412206334b89800033198.html
 */

import { round2 } from "@/lib/accounting/math";

export type RotRutType = "ROT" | "RUT";

export const isRotRutType = (value: unknown): value is RotRutType => value === "ROT" || value === "RUT";

// ─── Rates and caps, by the customer's payment date ──────────────────────────

export type RotRutRule = {
  /** First payment date the row applies to (YYYY-MM-DD). */
  from: string;
  /** Share of the labour cost including VAT. */
  rotRate: number;
  rutRate: number;
  /** Most ROT one person can get in the year. */
  rotCap: number;
  /** Most RUT one person can get in the year. */
  rutCap: number;
  /** Most ROT and RUT together one person can get in the year. */
  totalCap: number;
};

/**
 * A dated table, newest last. Dates before the first row use the first row.
 * 2024: the caps were separate for the tax year (75 000 each), but payments
 * up to 30 June counted against the old limits (SFS 2024:415 point 3).
 * 2025: ROT was 50 % for work paid 12 May to 31 December (SFS 2025:321, 322).
 */
export const ROT_RUT_RULES: RotRutRule[] = [
  { from: "2021-01-01", rotRate: 0.3, rutRate: 0.5, rotCap: 50_000, rutCap: 75_000, totalCap: 75_000 },
  { from: "2024-07-01", rotRate: 0.3, rutRate: 0.5, rotCap: 75_000, rutCap: 75_000, totalCap: 150_000 },
  { from: "2025-01-01", rotRate: 0.3, rutRate: 0.5, rotCap: 50_000, rutCap: 75_000, totalCap: 75_000 },
  { from: "2025-05-12", rotRate: 0.5, rutRate: 0.5, rotCap: 50_000, rutCap: 75_000, totalCap: 75_000 },
  { from: "2026-01-01", rotRate: 0.3, rutRate: 0.5, rotCap: 50_000, rutCap: 75_000, totalCap: 75_000 }
];

const isoOf = (date: Date | string) => (typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10));

export const rotRutRuleFor = (date: Date | string): RotRutRule => {
  const iso = isoOf(date);
  let rule = ROT_RUT_RULES[0];
  for (const row of ROT_RUT_RULES) if (row.from <= iso) rule = row;
  return rule;
};

export const rotRutRateFor = (type: RotRutType, date: Date | string) => {
  const rule = rotRutRuleFor(date);
  return type === "ROT" ? rule.rotRate : rule.rutRate;
};

/** The most one person can get for this type in the year of the date. */
export const rotRutCapFor = (type: RotRutType, date: Date | string) => {
  const rule = rotRutRuleFor(date);
  return type === "ROT" ? Math.min(rule.rotCap, rule.totalCap) : Math.min(rule.rutCap, rule.totalCap);
};

// ─── Types of work (the codes the request file uses) ─────────────────────────

export type RotRutWorkType = { code: string; sv: string; en: string };

export const ROT_WORK_TYPES: RotRutWorkType[] = [
  { code: "BYGG", sv: "Bygg", en: "Building and carpentry" },
  { code: "EL", sv: "El", en: "Electrical work" },
  { code: "GLASARBETE", sv: "Glas och plåt", en: "Glass and sheet metal" },
  { code: "MARKARBETE", sv: "Gräv- och markarbete", en: "Ground work and drainage" },
  { code: "MURNING", sv: "Murning", en: "Masonry" },
  { code: "MALNING_TAPETSERING", sv: "Målning och tapetsering", en: "Painting and wallpapering" },
  { code: "VVS", sv: "VVS", en: "Plumbing and heating" }
];

/**
 * The two services with a standard labour share (transport till försäljning,
 * tvätt vid tvättinrättning) are left out: they follow other rules.
 */
export const RUT_WORK_TYPES: RotRutWorkType[] = [
  { code: "STADNING", sv: "Städning", en: "Cleaning" },
  { code: "KLAD_TEXTILVARD", sv: "Kläd- och textilvård", en: "Clothes and textile care" },
  { code: "SNOSKOTTNING", sv: "Snöskottning", en: "Snow clearing" },
  { code: "TRADGARDSARBETE", sv: "Trädgårdsarbete", en: "Gardening" },
  { code: "BARNPASSNING", sv: "Barnpassning", en: "Childminding" },
  { code: "PERSONLIG_OMSORG", sv: "Personlig omsorg", en: "Personal care" },
  { code: "FLYTTJANSTER", sv: "Flyttjänster", en: "Moving services" },
  { code: "IT_TJANSTER", sv: "It-tjänster", en: "IT services at home" },
  { code: "REPARATION_VITVAROR", sv: "Reparation av vitvaror", en: "Repair of white goods" },
  { code: "MOBLERING", sv: "Möblering", en: "Furnishing" },
  { code: "TILLSYN_AV_BOSTAD", sv: "Tillsyn av bostad", en: "Home supervision" }
];

export const rotRutWorkTypes = (type: RotRutType) => (type === "ROT" ? ROT_WORK_TYPES : RUT_WORK_TYPES);

export const isRotRutWorkType = (type: RotRutType, code: string | null | undefined) =>
  Boolean(code) && rotRutWorkTypes(type).some((row) => row.code === code);

export const rotRutWorkTypeLabel = (code: string | null | undefined, locale: "sv" | "en") => {
  const row = [...ROT_WORK_TYPES, ...RUT_WORK_TYPES].find((item) => item.code === code);
  return row ? row[locale] : (code ?? "");
};

// ─── Personnummer and organisation number ────────────────────────────────────

const luhnValid = (digits: string) => {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let value = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
};

export type ParsedPersonnummer =
  | { ok: true; /** Twelve digits: YYYYMMDDNNNN. */ value: string; birthYear: number }
  | { ok: false; reason: "format" | "date" | "checksum" };

/**
 * A Swedish personnummer or samordningsnummer, with the check digit verified.
 * Accepts ten or twelve digits with or without "-" or "+" before the last four.
 */
export const parsePersonnummer = (input: string, today: Date = new Date()): ParsedPersonnummer => {
  const match = /^(\d{6}|\d{8})([-+]?)(\d{4})$/.exec(input.replace(/\s+/g, ""));
  if (!match) return { ok: false, reason: "format" };
  const [, datePart, separator, last] = match;
  const short = datePart.slice(-6);

  let year: number;
  if (datePart.length === 8) {
    year = Number(datePart.slice(0, 4));
  } else {
    const thisYear = today.getUTCFullYear();
    year = Math.floor(thisYear / 100) * 100 + Number(short.slice(0, 2));
    if (year > thisYear) year -= 100;
    if (separator === "+") year -= 100;
  }
  const month = Number(short.slice(2, 4));
  const dayRaw = Number(short.slice(4, 6));
  // A samordningsnummer has 60 added to the day.
  const day = dayRaw > 60 ? dayRaw - 60 : dayRaw;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1880 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, reason: "date" };
  }
  if (!luhnValid(`${short}${last}`)) return { ok: false, reason: "checksum" };
  return { ok: true, value: `${String(year).padStart(4, "0")}${short.slice(2)}${last}`, birthYear: year };
};

/** "19840601-2388" for the invoice and the request. */
export const formatPersonnummer = (twelveDigits: string) =>
  /^\d{12}$/.test(twelveDigits) ? `${twelveDigits.slice(0, 8)}-${twelveDigits.slice(8)}` : twelveDigits;

/** "19840601-****" for lists and anywhere the full number is not needed. */
export const maskPersonnummer = (twelveDigits: string | null | undefined) =>
  twelveDigits && /^\d{12}$/.test(twelveDigits) ? `${twelveDigits.slice(0, 8)}-****` : "****";

export type ParsedOrgNumber = { ok: true; /** "NNNNNN-NNNN" */ value: string } | { ok: false; reason: "format" | "checksum" };

/** A Swedish organisation number (ten digits, third digit 2 or higher, modulus 10). */
export const parseOrgNumber = (input: string): ParsedOrgNumber => {
  const digits = input.replace(/[\s-]/g, "");
  const ten = /^16\d{10}$/.test(digits) ? digits.slice(2) : digits;
  if (!/^\d{10}$/.test(ten) || Number(ten[2]) < 2) return { ok: false, reason: "format" };
  if (!luhnValid(ten)) return { ok: false, reason: "checksum" };
  return { ok: true, value: `${ten.slice(0, 6)}-${ten.slice(6)}` };
};

/**
 * Twelve digits for the request file: a personnummer with its century, an
 * organisation number with "16" in front (as in Skatteverket's examples).
 * Null when the value is neither.
 */
export const toTwelveDigitId = (value: string | null | undefined, today: Date = new Date()): string | null => {
  if (!value?.trim()) return null;
  const person = parsePersonnummer(value, today);
  if (person.ok) return person.value;
  const org = parseOrgNumber(value);
  if (org.ok) return `16${org.value.replace("-", "")}`;
  return null;
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export type RotRutErrorCode =
  | "no_f_skatt"
  | "accrual"
  | "currency"
  | "type"
  | "personnummer_format"
  | "personnummer_date"
  | "personnummer_checksum"
  | "buyer_is_seller"
  | "buyer_too_young"
  | "property_missing"
  | "property_too_long"
  | "brf_org_number"
  | "apartment_number"
  | "no_labour"
  | "work_type"
  | "hours"
  | "hours_too_many"
  | "not_rot_rut"
  | "not_found"
  | "void"
  | "credited"
  | "customer_unpaid"
  | "not_ready"
  | "not_requested"
  | "already_paid_out"
  | "not_paid_out"
  | "payout_amount"
  | "payout_date"
  | "requested"
  | "paid_out"
  | "customer_paid_shortfall"
  | "performer_id"
  | "too_many"
  | "mixed_years"
  | "nothing_ready"
  | "full_credit_only";

export class RotRutError extends Error {
  constructor(
    public readonly code: RotRutErrorCode,
    public readonly status: number = 422
  ) {
    super(rotRutErrorText(code, "en"));
    this.name = "RotRutError";
  }
}

export function rotRutErrorText(code: RotRutErrorCode, locale: "sv" | "en"): string {
  const sv = locale === "sv";
  switch (code) {
    case "no_f_skatt":
      return sv
        ? "Rot och rut kräver att företaget är godkänt för F-skatt. Ändra det under Inställningar om det inte stämmer."
        : "ROT and RUT require that the business is approved for F-tax (F-skatt). Change it under Settings if that is wrong.";
    case "accrual":
      return sv
        ? "Rot och rut går ännu inte att använda med fakturametoden i Akunta, eftersom bokföringen av fakturor där inte är klar. Inget har sparats."
        : "ROT and RUT cannot be used with the invoice method (fakturametoden) in Akunta yet, because invoice bookkeeping there is not finished. Nothing was saved.";
    case "currency":
      return sv ? "En faktura med rot eller rut måste vara i svenska kronor." : "An invoice with ROT or RUT must be in Swedish kronor.";
    case "type":
      return sv ? "Välj rot eller rut." : "Choose ROT or RUT.";
    case "personnummer_format":
      return sv
        ? "Skriv kundens personnummer med tio eller tolv siffror, till exempel 19840601-2388."
        : "Enter the customer's personnummer with ten or twelve digits, for example 19840601-2388.";
    case "personnummer_date":
      return sv ? "Personnumret innehåller ett datum som inte finns." : "The personnummer contains a date that does not exist.";
    case "personnummer_checksum":
      return sv
        ? "Personnumrets kontrollsiffra stämmer inte. Kontrollera siffrorna med kunden."
        : "The check digit of the personnummer is wrong. Check the digits with the customer.";
    case "buyer_is_seller":
      return sv
        ? "Kundens personnummer är samma som ditt eget. Du kan inte få rot eller rut för arbete åt dig själv."
        : "The customer's personnummer is the same as your own. You cannot get ROT or RUT for work done for yourself.";
    case "buyer_too_young":
      return sv
        ? "Kunden måste fylla minst 18 år under året för att få rot eller rut."
        : "The customer must turn at least 18 during the year to get ROT or RUT.";
    case "property_missing":
      return sv
        ? "Ange fastighetsbeteckningen, till exempel Sollentuna Eken 12."
        : "Enter the property designation (fastighetsbeteckning), for example Sollentuna Eken 12.";
    case "property_too_long":
      return sv ? "Fastighetsbeteckningen får vara högst 40 tecken." : "The property designation can be at most 40 characters.";
    case "brf_org_number":
      return sv
        ? "Bostadsrättsföreningens organisationsnummer stämmer inte. Det har tio siffror, till exempel 769600-1234."
        : "The housing society's organisation number is not valid. It has ten digits, for example 769600-1234.";
    case "apartment_number":
      return sv
        ? "Ange lägenhetsnumret (vanligen fyra siffror, till exempel 1102)."
        : "Enter the apartment number (usually four digits, for example 1102).";
    case "no_labour":
      return sv
        ? "Minst en rad måste vara arbete för att kunden ska få rot eller rut."
        : "At least one line must be labour for the customer to get ROT or RUT.";
    case "work_type":
      return sv ? "Välj typ av arbete för varje arbetsrad." : "Choose the type of work for every labour line.";
    case "hours":
      return sv
        ? "Ange antal arbetade timmar för varje arbetsrad, även vid fast pris."
        : "Enter the hours worked for every labour line, also for fixed-price work.";
    case "hours_too_many":
      return sv
        ? "Skatteverket tar emot högst 999 timmar per typ av arbete och faktura."
        : "Skatteverket accepts at most 999 hours per type of work and invoice.";
    case "not_rot_rut":
      return sv ? "Fakturan har varken rot eller rut." : "This invoice has no ROT or RUT.";
    case "not_found":
      return sv ? "Fakturan hittades inte." : "Invoice not found.";
    case "void":
      return sv ? "Fakturan är makulerad." : "Invoice is voided.";
    case "credited":
      return sv
        ? "Fakturan är krediterad, så det finns inget att begära från Skatteverket."
        : "This invoice has been credited, so there is nothing to request from Skatteverket.";
    case "customer_unpaid":
      return sv
        ? "Kunden har inte betalat hela sin del ännu. Skatteverket betalar bara ut när arbetet är utfört och kunden har betalat."
        : "The customer has not paid their whole part yet. Skatteverket only pays out once the work is done and the customer has paid.";
    case "not_ready":
      return sv
        ? "Fakturan är inte redo att begäras. Kunden måste ha betalat sin del och begäran får inte redan vara skickad."
        : "This invoice is not ready to be requested. The customer must have paid their part and the request must not already be sent.";
    case "not_requested":
      return sv ? "Begäran är inte markerad som skickad." : "The request is not marked as sent.";
    case "already_paid_out":
      return sv ? "Utbetalningen från Skatteverket är redan registrerad." : "The payout from Skatteverket is already registered.";
    case "not_paid_out":
      return sv ? "Ingen utbetalning från Skatteverket är registrerad." : "No payout from Skatteverket is registered.";
    case "payout_amount":
      return sv
        ? "Beloppet kan inte vara större än det du begärde, och inte mindre än noll."
        : "The amount cannot be more than what you requested, and not less than zero.";
    case "payout_date":
      return sv
        ? "Utbetalningen kan inte ha kommit före kundens betalning eller i framtiden."
        : "The payout cannot have arrived before the customer's payment or in the future.";
    case "requested":
      return sv
        ? "Begäran till Skatteverket är markerad som skickad. Ta tillbaka begäran hos Skatteverket och ångra markeringen här först."
        : "The request to Skatteverket is marked as sent. Withdraw the request at Skatteverket and undo the mark here first.";
    case "paid_out":
      return sv
        ? "Skatteverkets utbetalning är registrerad. Ångra utbetalningen här först."
        : "Skatteverket's payout is registered. Undo the payout here first.";
    case "customer_paid_shortfall":
      return sv
        ? "Kunden har redan betalat mellanskillnaden. Ångra den betalningen innan du ångrar utbetalningen."
        : "The customer has already paid the difference. Undo that payment before you undo the payout.";
    case "performer_id":
      return sv
        ? "Filen behöver ditt personnummer (eller organisationsnummer). Lägg in det under Inställningar."
        : "The file needs your personnummer (or organisation number). Add it under Settings.";
    case "too_many":
      return sv ? "En fil får innehålla högst 100 köpare." : "One file can hold at most 100 buyers.";
    case "mixed_years":
      return sv
        ? "En fil får bara innehålla betalningar från samma år."
        : "One file can only hold payments from the same year.";
    case "nothing_ready":
      return sv ? "Det finns inga fakturor som är redo att begäras." : "There are no invoices ready to be requested.";
    case "full_credit_only":
      return sv
        ? "En faktura med rot eller rut kan bara krediteras i sin helhet innan Skatteverket har betalat ut. Kreditera hela fakturan och skapa en ny."
        : "An invoice with ROT or RUT can only be credited in full before Skatteverket has paid out. Credit the whole invoice and create a new one.";
  }
}

// ─── Buyer details ───────────────────────────────────────────────────────────

export type RotRutBuyerInput = {
  personnummer: string;
  /** ROT only: a house (property designation) or a flat in a housing society. */
  housing?: "property" | "apartment";
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
  /** Asked by Skatteverket from 1 January 2027. */
  subcontractor?: boolean;
  staffingAgency?: boolean;
};

/** What is stored in Invoice.rotRutDetailsJson. The only place the personnummer is kept. */
export type RotRutDetails = {
  v: 1;
  /** Twelve digits. */
  personnummer: string;
  housing?: "property" | "apartment";
  propertyDesignation?: string;
  /** "NNNNNN-NNNN" */
  brfOrgNumber?: string;
  apartmentNumber?: string;
  subcontractor: boolean;
  staffingAgency: boolean;
  /** The rate the preliminary reduction was calculated with. */
  rate: number;
  /** What Skatteverket actually paid, once registered. */
  payoutAmount?: number;
};

export const validateRotRutBuyer = (
  type: RotRutType,
  input: RotRutBuyerInput,
  context: { year: number; performerId?: string | null; today?: Date }
): Omit<RotRutDetails, "rate"> => {
  const person = parsePersonnummer(input.personnummer ?? "", context.today);
  if (!person.ok) throw new RotRutError(`personnummer_${person.reason}`);
  if (context.performerId && toTwelveDigitId(context.performerId, context.today) === person.value) {
    throw new RotRutError("buyer_is_seller");
  }
  if (person.birthYear > context.year - 18) throw new RotRutError("buyer_too_young");

  const base = {
    v: 1 as const,
    personnummer: person.value,
    subcontractor: Boolean(input.subcontractor),
    staffingAgency: Boolean(input.staffingAgency)
  };
  if (type === "RUT") return base;

  if (input.housing === "apartment") {
    const org = parseOrgNumber(input.brfOrgNumber ?? "");
    if (!org.ok) throw new RotRutError("brf_org_number");
    const apartment = (input.apartmentNumber ?? "").trim();
    if (!apartment || apartment.length > 25) throw new RotRutError("apartment_number");
    return { ...base, housing: "apartment", brfOrgNumber: org.value, apartmentNumber: apartment };
  }
  const designation = (input.propertyDesignation ?? "").trim().replace(/\s+/g, " ");
  if (!designation) throw new RotRutError("property_missing");
  if (designation.length > 40) throw new RotRutError("property_too_long");
  return { ...base, housing: "property", propertyDesignation: designation };
};

export const parseRotRutDetails = (json: string | null | undefined): RotRutDetails | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<RotRutDetails>;
    if (!parsed || typeof parsed.personnummer !== "string") return null;
    return {
      v: 1,
      personnummer: parsed.personnummer,
      housing: parsed.housing === "apartment" || parsed.housing === "property" ? parsed.housing : undefined,
      propertyDesignation: parsed.propertyDesignation,
      brfOrgNumber: parsed.brfOrgNumber,
      apartmentNumber: parsed.apartmentNumber,
      subcontractor: Boolean(parsed.subcontractor),
      staffingAgency: Boolean(parsed.staffingAgency),
      rate: typeof parsed.rate === "number" ? parsed.rate : 0,
      payoutAmount: typeof parsed.payoutAmount === "number" ? parsed.payoutAmount : undefined
    };
  } catch {
    return null;
  }
};

/** "Sollentuna Eken 12", or "Brf 769600-1234, lägenhet 1102". Empty for RUT. */
export const rotRutPropertyText = (details: Pick<RotRutDetails, "housing" | "propertyDesignation" | "brfOrgNumber" | "apartmentNumber">, locale: "sv" | "en") => {
  if (details.housing === "apartment") {
    return locale === "sv"
      ? `Bostadsrättsförening ${details.brfOrgNumber ?? ""}, lägenhet ${details.apartmentNumber ?? ""}`
      : `Housing society ${details.brfOrgNumber ?? ""}, apartment ${details.apartmentNumber ?? ""}`;
  }
  return details.propertyDesignation ?? "";
};

// ─── The reduction ───────────────────────────────────────────────────────────

export type RotRutLine = {
  /** Line total including VAT. */
  totalAmount: number;
  /** True: qualifying labour. */
  labour: boolean;
  /** On a labour line: the type of work. On another line: the type of work the material belongs to, or null for other costs. */
  workType?: string | null;
  hours?: number | null;
};

export type RotRutComputation = {
  type: RotRutType;
  rate: number;
  /** The yearly cap per person for this type. */
  cap: number;
  grossAmount: number;
  /** Including VAT. */
  labourAmount: number;
  materialAmount: number;
  otherAmount: number;
  /** The preliminary reduction in whole kronor: what is requested from Skatteverket. */
  deduction: number;
  /** True when the yearly cap cut the reduction on this invoice. */
  capped: boolean;
  customerPays: number;
};

/** Labour, material and other costs on the invoice, each including VAT. */
export const rotRutLineSums = (lines: RotRutLine[]) => {
  const sum = (rows: RotRutLine[]) => round2(rows.reduce((total, row) => total + row.totalAmount, 0));
  return {
    labourAmount: sum(lines.filter((line) => line.labour)),
    materialAmount: sum(lines.filter((line) => !line.labour && line.workType)),
    otherAmount: sum(lines.filter((line) => !line.labour && !line.workType)),
    grossAmount: sum(lines)
  };
};

/**
 * The preliminary reduction: the rate times the labour cost including VAT,
 * rounded down to whole kronor (the request takes no öre) and never above
 * the yearly cap for one person.
 */
export const computeRotRut = (input: { type: RotRutType; date: Date | string; lines: RotRutLine[] }): RotRutComputation => {
  const rate = rotRutRateFor(input.type, input.date);
  const cap = rotRutCapFor(input.type, input.date);
  const { labourAmount, materialAmount, otherAmount, grossAmount } = rotRutLineSums(input.lines);
  // In öre and whole percent, so 30 % of 12 500,00 is exactly 3 750.
  const uncapped = Math.floor((Math.round(labourAmount * 100) * Math.round(rate * 100)) / 10_000);
  const deduction = Math.max(0, Math.min(uncapped, cap));
  return {
    type: input.type,
    rate,
    cap,
    grossAmount,
    labourAmount,
    materialAmount,
    otherAmount,
    deduction,
    capped: uncapped > cap,
    customerPays: round2(grossAmount - deduction)
  };
};

/** Checks the lines of a new ROT/RUT invoice. Throws RotRutError. */
export const assertRotRutLines = (type: RotRutType, lines: RotRutLine[]) => {
  const labour = lines.filter((line) => line.labour);
  if (labour.length === 0 || labour.every((line) => line.totalAmount <= 0)) throw new RotRutError("no_labour");
  const hoursByType = new Map<string, number>();
  for (const line of labour) {
    if (!isRotRutWorkType(type, line.workType)) throw new RotRutError("work_type");
    if (!line.hours || !Number.isFinite(line.hours) || line.hours <= 0) throw new RotRutError("hours");
    hoursByType.set(line.workType as string, (hoursByType.get(line.workType as string) ?? 0) + line.hours);
  }
  for (const hours of hoursByType.values()) if (Math.round(hours) > 999) throw new RotRutError("hours_too_many");
};

// ─── Where an invoice stands ─────────────────────────────────────────────────

export type RotRutStage =
  /** Credited or voided before Skatteverket paid: nothing to request. */
  | "cancelled"
  /** The customer has not paid their whole part. */
  | "awaiting_customer"
  /** The customer has paid: the payout can be requested. */
  | "ready"
  /** The request has been sent, the payout has not been registered. */
  | "requested"
  | "paid_out";

export const rotRutStage = (invoice: {
  rotRutType: string | null;
  status: string;
  creditedAmount: number;
  /** What the customer still owes. */
  remaining: number;
  rotRutRequestedAt: Date | null;
  rotRutPaidOutAt: Date | null;
}): RotRutStage | null => {
  if (!isRotRutType(invoice.rotRutType)) return null;
  if (invoice.rotRutPaidOutAt) return "paid_out";
  if (invoice.status === "VOID" || invoice.creditedAmount > 0) return "cancelled";
  if (invoice.rotRutRequestedAt) return "requested";
  return invoice.remaining > 0.004 ? "awaiting_customer" : "ready";
};

/**
 * The part of the invoice the customer does not owe: the preliminary
 * reduction, or once Skatteverket has paid, what it actually paid. (If it
 * paid less, the difference is the customer's to pay.)
 */
export const rotRutSkatteverketAmount = (invoice: {
  rotRutType?: string | null;
  rotRutDeduction?: unknown;
  rotRutPaidOutAt?: Date | null;
  rotRutDetailsJson?: string | null;
}): { share: number; received: number } => {
  if (!isRotRutType(invoice.rotRutType) || invoice.rotRutDeduction == null) return { share: 0, received: 0 };
  const deduction = round2(Number(String(invoice.rotRutDeduction)));
  if (!Number.isFinite(deduction) || deduction <= 0) return { share: 0, received: 0 };
  if (!invoice.rotRutPaidOutAt) return { share: deduction, received: 0 };
  const paid = parseRotRutDetails(invoice.rotRutDetailsJson)?.payoutAmount;
  const received = paid === undefined ? deduction : Math.max(0, Math.min(deduction, round2(paid)));
  return { share: received, received };
};

/**
 * A customer payment cannot be undone while the request to Skatteverket rests
 * on it: not while the request is marked as sent, and after the payout only
 * a payment of the difference Skatteverket did not pay (so that the
 * customer's own part stays paid). Returns why, or null when undoing is fine.
 */
export const rotRutBlocksPaymentUndo = (invoice: {
  rotRutType: string | null;
  rotRutRequestedAt: Date | null;
  rotRutPaidOutAt: Date | null;
  /** What the customer will have paid and been credited once the payment is undone. */
  settledAfterUndo: number;
  /** The invoice minus the full preliminary reduction. */
  customerPart: number;
}): "paid_out" | "requested" | null => {
  if (!isRotRutType(invoice.rotRutType)) return null;
  if (invoice.rotRutPaidOutAt) return invoice.settledAfterUndo + 0.004 >= invoice.customerPart ? null : "paid_out";
  return invoice.rotRutRequestedAt ? "requested" : null;
};

/** The request must reach Skatteverket by 31 January the year after the customer paid. */
export const rotRutDeadline = (paymentDate: Date) => new Date(Date.UTC(paymentDate.getUTCFullYear() + 1, 0, 31));

export const ROT_RUT_DEADLINE_WARNING_DAYS = 45;

export const rotRutDeadlineState = (deadline: Date, today: Date) => {
  const daysLeft = Math.round((deadline.valueOf() - today.valueOf()) / 86_400_000);
  return { daysLeft, passed: daysLeft < 0, soon: daysLeft >= 0 && daysLeft <= ROT_RUT_DEADLINE_WARNING_DAYS };
};

// ─── The request to Skatteverket ─────────────────────────────────────────────

export type RotRutCase = {
  invoiceNumber: string;
  /** Twelve digits. */
  buyer: string;
  propertyDesignation?: string;
  apartmentNumber?: string;
  /** Twelve digits ("16" + organisation number). */
  brfOrgNumber?: string;
  works: { type: string; hours: number; material: number }[];
  otherCost: number;
  /** YYYY-MM-DD: the day the customer's payment arrived. */
  paymentDate: string;
  /** Arbetskostnad: labour invoiced, including VAT. */
  labourCost: number;
  /** Betalt belopp: what the customer paid for the labour, after the reduction. */
  paidAmount: number;
  /** Begärt belopp. */
  requestedAmount: number;
  subcontractor: boolean;
  staffingAgency: boolean;
};

/**
 * The values of one request, in whole kronor. Material and other costs are
 * given as invoiced, including VAT. Hours are summed per type of work and
 * rounded to whole hours (at least 1).
 */
export const buildRotRutCase = (input: {
  type: RotRutType;
  invoiceNumber: string;
  details: RotRutDetails;
  deduction: number;
  paymentDate: Date | string;
  lines: RotRutLine[];
}): RotRutCase => {
  const labourLines = input.lines.filter((line) => line.labour);
  const types: string[] = [];
  for (const line of labourLines) {
    if (line.workType && !types.includes(line.workType)) types.push(line.workType);
  }
  const labourExact = round2(labourLines.reduce((sum, line) => sum + line.totalAmount, 0));
  const labourCost = Math.floor(labourExact + 1e-9);
  const requestedAmount = Math.floor(input.deduction + 1e-9);

  let otherExact = 0;
  const materialByType = new Map<string, number>();
  for (const line of input.lines) {
    if (line.labour) continue;
    // Material marked for a type of work that is not on the invoice goes with the first one.
    const type = line.workType ? (types.includes(line.workType) ? line.workType : types[0]) : null;
    if (type) materialByType.set(type, (materialByType.get(type) ?? 0) + line.totalAmount);
    else otherExact += line.totalAmount;
  }

  const works = types.map((type) => ({
    type,
    hours: Math.min(
      999,
      Math.max(
        1,
        Math.round(labourLines.filter((line) => line.workType === type).reduce((sum, line) => sum + (line.hours ?? 0), 0))
      )
    ),
    material: Math.round(materialByType.get(type) ?? 0)
  }));

  const apartment = input.type === "ROT" && input.details.housing === "apartment";
  return {
    invoiceNumber: input.invoiceNumber.slice(0, 20),
    buyer: input.details.personnummer,
    propertyDesignation: input.type === "ROT" && !apartment ? input.details.propertyDesignation : undefined,
    apartmentNumber: apartment ? input.details.apartmentNumber : undefined,
    brfOrgNumber: apartment ? (toTwelveDigitId(input.details.brfOrgNumber) ?? undefined) : undefined,
    works,
    otherCost: Math.round(otherExact),
    paymentDate: isoOf(input.paymentDate),
    labourCost,
    paidAmount: Math.max(0, labourCost - requestedAmount),
    requestedAmount,
    subcontractor: input.details.subcontractor,
    staffingAgency: input.details.staffingAgency
  };
};

export type RotRutSchemaVersion = "1.0" | "1.1";

/** Version 1.1 (with the subcontractor and staffing agency answers) is for requests made from 1 January 2027. */
export const rotRutSchemaVersionFor = (today: Date | string): RotRutSchemaVersion => (isoOf(today) >= "2027-01-01" ? "1.1" : "1.0");

export const ROT_RUT_MAX_CASES_PER_FILE = 100;

const xmlEscape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * "Begäran om utbetalning" as a file for the e-service Rot och rut - företag.
 * Element names and order follow Skatteverket's Begaran.xsd, version 1.0 or
 * 1.1. One file holds one type (ROT or RUT), one payment year and at most
 * 100 buyers.
 */
export const buildRotRutRequestXml = (input: {
  version: RotRutSchemaVersion;
  type: RotRutType;
  /** Shown in the e-service. At most 16 characters. */
  name: string;
  /** The business: twelve digits. */
  performer: string;
  cases: RotRutCase[];
}): string => {
  if (!/^\d{12}$/.test(input.performer)) throw new RotRutError("performer_id");
  if (input.cases.length === 0) throw new RotRutError("nothing_ready", 409);
  if (input.cases.length > ROT_RUT_MAX_CASES_PER_FILE) throw new RotRutError("too_many");
  if (new Set(input.cases.map((item) => item.paymentDate.slice(0, 4))).size > 1) throw new RotRutError("mixed_years");

  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 16).trim() || input.type;
  const tag = (indent: string, element: string, value: string | number | boolean) =>
    `${indent}<p:${element}>${xmlEscape(String(value))}</p:${element}>`;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<p:Begaran xmlns:p="http://xmls.skatteverket.se/se/skatteverket/skattered/begaran/${input.version}">`,
    tag("  ", "NamnPaBegaran", name),
    tag("  ", "TypAvBegaran", input.type),
    tag("  ", "Utforare", input.performer)
  ];
  for (const item of input.cases) {
    lines.push("  <p:Arende>");
    lines.push(tag("    ", "FakturaNr", item.invoiceNumber));
    lines.push(tag("    ", "Kopare", item.buyer));
    if (input.type === "ROT") {
      lines.push("    <p:Fastighet>");
      if (item.propertyDesignation) lines.push(tag("      ", "Fastighetsbeteckning", item.propertyDesignation));
      if (item.apartmentNumber) lines.push(tag("      ", "LagenhetsNr", item.apartmentNumber));
      if (item.brfOrgNumber) lines.push(tag("      ", "BrfOrgNr", item.brfOrgNumber));
      lines.push("    </p:Fastighet>");
    }
    for (const work of item.works) {
      lines.push("    <p:UtfortArbete>");
      lines.push(tag("      ", "TypAvUtfortArbete", work.type));
      lines.push(tag("      ", "AntalTimmar", work.hours));
      lines.push(tag("      ", "Kostnad", work.material));
      lines.push("    </p:UtfortArbete>");
    }
    lines.push(tag("    ", "OvrigKostnad", item.otherCost));
    lines.push(tag("    ", "Betalningsdatum", item.paymentDate));
    lines.push(tag("    ", "Arbetskostnad", item.labourCost));
    lines.push(tag("    ", "BetaltBelopp", item.paidAmount));
    lines.push(tag("    ", "BegartBelopp", item.requestedAmount));
    if (input.version === "1.1") {
      lines.push(tag("    ", "Underentreprenor", item.subcontractor));
      lines.push(tag("    ", "Bemanningsforetag", item.staffingAgency));
    }
    lines.push("  </p:Arende>");
  }
  lines.push("</p:Begaran>", "");
  return lines.join("\n");
};

/** The same values in plain words, for checking the file or typing the request by hand. */
export const rotRutCaseSummary = (item: RotRutCase, type: RotRutType, locale: "sv" | "en"): { label: string; value: string }[] => {
  const sv = locale === "sv";
  const kr = (value: number) => `${new Intl.NumberFormat(sv ? "sv-SE" : "en-GB").format(value)} kr`;
  const rows: { label: string; value: string }[] = [
    { label: sv ? "Fakturanummer" : "Invoice number", value: item.invoiceNumber },
    { label: sv ? "Köparens personnummer" : "Buyer's personnummer", value: formatPersonnummer(item.buyer) }
  ];
  if (type === "ROT") {
    if (item.propertyDesignation) rows.push({ label: sv ? "Fastighetsbeteckning" : "Property designation", value: item.propertyDesignation });
    if (item.brfOrgNumber) {
      rows.push({
        label: sv ? "Bostadsrättsföreningens organisationsnummer" : "Housing society's organisation number",
        value: `${item.brfOrgNumber.slice(2, 8)}-${item.brfOrgNumber.slice(8)}`
      });
    }
    if (item.apartmentNumber) rows.push({ label: sv ? "Lägenhetsnummer" : "Apartment number", value: item.apartmentNumber });
  }
  for (const work of item.works) {
    rows.push({
      label: rotRutWorkTypeLabel(work.type, locale),
      value: sv
        ? `${work.hours} timmar, materialkostnad ${kr(work.material)}`
        : `${work.hours} hours, material cost ${kr(work.material)}`
    });
  }
  rows.push(
    { label: sv ? "Övrig kostnad" : "Other cost", value: kr(item.otherCost) },
    { label: sv ? "Betalningsdatum" : "Payment date", value: item.paymentDate },
    { label: sv ? "Arbetskostnad (inkl. moms)" : "Labour cost (incl. VAT)", value: kr(item.labourCost) },
    { label: sv ? "Betalt belopp" : "Amount paid", value: kr(item.paidAmount) },
    { label: sv ? "Begärt belopp" : "Amount requested", value: kr(item.requestedAmount) },
    {
      label: sv ? "Underentreprenör anlitad" : "Subcontractor used",
      value: item.subcontractor ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"
    },
    {
      label: sv ? "Bemanningsföretag anlitat" : "Staffing agency used",
      value: item.staffingAgency ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"
    }
  );
  return rows;
};
