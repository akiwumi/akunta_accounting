/**
 * Country tax profile template registry.
 * All 27 EU member states + United Kingdom.
 *
 * Rates are reasonable approximations for 2024-2025 based on OECD/EC public data.
 * Always verify against official sources before using for actual tax filing.
 */

import type { CountryProfileTemplate } from "./types";

// ─── Helper ───────────────────────────────────────────────────────────────────

const progressive = (
  bands: Array<[number, number | null, number, string?]>
): CountryProfileTemplate["incomeTaxBands"] =>
  bands.map(([from, to, rate, label], i) => ({
    bandOrder: i + 1,
    fromAmount: from,
    toAmount: to,
    rate,
    label
  }));

// ─── Templates ───────────────────────────────────────────────────────────────

const SE: CountryProfileTemplate = {
  countryCode: "SE",
  countryName: "Sweden",
  templateFamily: "Nordic-SE",
  templateVersion: "1.0.0",
  vatStandardRate: 0.25,
  vatReducedRate1: 0.12,
  vatReducedRate2: 0.06,
  vatRegistrationThreshold: 80000,
  vatCashAccounting: true,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "yearly",
  vatPaymentDueDays: 26,
  incomeTaxMode: "flat",
  incomeTaxBands: [],
  flatIncomeTaxRate: 0.32,
  municipalSurchargeRate: 0.32,
  nationalSurchargeRate: 0.2,
  nationalSurchargeThreshold: 598500,
  socialContributionRate: 0.2897,
  pensionContributionRate: 0.045,
  generalDeductionRate: 0.25,
  employerContributionRate: 0.3142,
  employeeWithholdingRate: 0.3,
  personalTaxIdLabel: "Personnummer",
  businessRegIdLabel: "Organisationsnummer",
  vatIdLabel: "VAT-nummer",
  socialContribLabel: "Egenavgifter",
  notes: ["Municipal tax rate varies by municipality (28–35%). Default 32% is a common average."]
};

const GB: CountryProfileTemplate = {
  countryCode: "GB",
  countryName: "United Kingdom",
  templateFamily: "UK",
  templateVersion: "1.0.0",
  vatStandardRate: 0.2,
  vatReducedRate1: 0.05,
  vatRegistrationThreshold: 90000,
  vatCashAccounting: true,
  ossEnabled: false,
  reverseChargeEnabled: true,
  taxYearStartMonth: 4,
  taxYearEndMonth: 3,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 30,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 12570, 0, "Personal allowance"],
    [12570, 50270, 0.2, "Basic rate"],
    [50270, 125140, 0.4, "Higher rate"],
    [125140, null, 0.45, "Additional rate"]
  ]),
  nationalSurchargeRate: 0.02,
  nationalSurchargeThreshold: 50270,
  socialContributionRate: 0.09,
  socialContributionCap: 50270,
  pensionContributionRate: 0,
  generalDeductionRate: 0,
  employerContributionRate: 0.138,
  employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "National Insurance Number",
  businessRegIdLabel: "Unique Taxpayer Reference (UTR)",
  vatIdLabel: "VAT Registration Number",
  socialContribLabel: "National Insurance (Class 4)",
  notes: [
    "Class 2 NI (flat rate) replaced by Class 4 from April 2024.",
    "MTD (Making Tax Digital) filing rules apply above the registration threshold."
  ]
};

const DE: CountryProfileTemplate = {
  countryCode: "DE",
  countryName: "Germany",
  templateFamily: "DACH",
  templateVersion: "1.0.0",
  vatStandardRate: 0.19,
  vatReducedRate1: 0.07,
  vatRegistrationThreshold: 22000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 10,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 11604, 0, "Tax-free allowance"],
    [11604, 17005, 0.14, "Entry zone"],
    [17005, 66760, 0.24, "Progression zone"],
    [66760, 277825, 0.42, "Top rate"],
    [277825, null, 0.45, "Reichensteuer"]
  ]),
  municipalSurchargeRate: 0.055,
  socialContributionRate: 0.147,
  pensionContributionRate: 0.093,
  generalDeductionRate: 0,
  employerContributionRate: 0.21,
  employeeWithholdingRate: 0.14,
  personalTaxIdLabel: "Steueridentifikationsnummer",
  businessRegIdLabel: "Steuernummer",
  vatIdLabel: "Umsatzsteuer-Identifikationsnummer",
  socialContribLabel: "Kranken- und Rentenversicherung",
  notes: ["Solidarity surcharge (Solidaritätszuschlag) of 5.5% applies above threshold."]
};

const FR: CountryProfileTemplate = {
  countryCode: "FR",
  countryName: "France",
  templateFamily: "EU-West",
  templateVersion: "1.0.0",
  vatStandardRate: 0.2,
  vatReducedRate1: 0.1,
  vatReducedRate2: 0.055,
  vatReducedRate3: 0.021,
  vatRegistrationThreshold: 36800,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "monthly",
  vatPaymentDueDays: 24,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 11294, 0, "Exonéré"],
    [11294, 28797, 0.11, "Tranche 2"],
    [28797, 82341, 0.3, "Tranche 3"],
    [82341, 177106, 0.41, "Tranche 4"],
    [177106, null, 0.45, "Tranche 5"]
  ]),
  socialContributionRate: 0.22,
  pensionContributionRate: 0.11,
  generalDeductionRate: 0,
  employerContributionRate: 0.45,
  employeeWithholdingRate: 0.22,
  personalTaxIdLabel: "Numéro fiscal (SPI)",
  businessRegIdLabel: "SIRET / SIREN",
  vatIdLabel: "Numéro de TVA intracommunautaire",
  socialContribLabel: "Cotisations sociales",
  notes: ["Micro-entrepreneur regime has simplified flat social contribution rates."]
};

const NL: CountryProfileTemplate = {
  countryCode: "NL",
  countryName: "Netherlands",
  templateFamily: "Benelux",
  templateVersion: "1.0.0",
  vatStandardRate: 0.21,
  vatReducedRate1: 0.09,
  vatRegistrationThreshold: 20000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 30,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 37149, 0.3697, "Box 1 — lower"],
    [37149, null, 0.495, "Box 1 — upper"]
  ]),
  socialContributionRate: 0.2765,
  pensionContributionRate: 0.0865,
  generalDeductionRate: 0,
  employerContributionRate: 0.19,
  employeeWithholdingRate: 0.37,
  personalTaxIdLabel: "Burgerservicenummer (BSN)",
  businessRegIdLabel: "KvK-nummer",
  vatIdLabel: "BTW-identificatienummer",
  socialContribLabel: "Zorgverzekeringswet / AOW",
  notes: ["Box 1 includes income tax + social premiums as a combined rate."]
};

const PL: CountryProfileTemplate = {
  countryCode: "PL",
  countryName: "Poland",
  templateFamily: "EU-Central",
  templateVersion: "1.0.0",
  vatStandardRate: 0.23,
  vatReducedRate1: 0.08,
  vatReducedRate2: 0.05,
  vatRegistrationThreshold: 200000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "monthly",
  vatPaymentDueDays: 25,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 30000, 0, "Tax-free amount"],
    [30000, 120000, 0.12, "First threshold"],
    [120000, null, 0.32, "Second threshold"]
  ]),
  municipalSurchargeRate: 0.04,
  socialContributionRate: 0.194,
  pensionContributionRate: 0.0976,
  generalDeductionRate: 0,
  employerContributionRate: 0.205,
  employeeWithholdingRate: 0.12,
  personalTaxIdLabel: "PESEL / NIP",
  businessRegIdLabel: "NIP",
  vatIdLabel: "NIP VAT",
  socialContribLabel: "ZUS (Zakład Ubezpieczeń Społecznych)",
  notes: ["Flat 19% lump sum (ryczałt) and linear tax options available; this template uses general rules."]
};

const AT: CountryProfileTemplate = {
  countryCode: "AT",
  countryName: "Austria",
  templateFamily: "EU-Central",
  templateVersion: "1.0.0",
  vatStandardRate: 0.2,
  vatReducedRate1: 0.13,
  vatReducedRate2: 0.1,
  vatRegistrationThreshold: 35000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 15,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 12816, 0, "Grundfreibetrag"],
    [12816, 20818, 0.2, ""],
    [20818, 34513, 0.3, ""],
    [34513, 66612, 0.4, ""],
    [66612, 99266, 0.48, ""],
    [99266, 1000000, 0.5, ""],
    [1000000, null, 0.55, "Millionärssteuer"]
  ]),
  socialContributionRate: 0.274,
  pensionContributionRate: 0.185,
  generalDeductionRate: 0,
  employerContributionRate: 0.21,
  employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "Sozialversicherungsnummer",
  businessRegIdLabel: "Steuernummer",
  vatIdLabel: "UID-Nummer",
  socialContribLabel: "Sozialversicherungsbeiträge (GSVG)"
};

const BE: CountryProfileTemplate = {
  countryCode: "BE",
  countryName: "Belgium",
  templateFamily: "EU-West",
  templateVersion: "1.0.0",
  vatStandardRate: 0.21,
  vatReducedRate1: 0.12,
  vatReducedRate2: 0.06,
  vatRegistrationThreshold: 0,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 20,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 15200, 0.25, ""],
    [15200, 26830, 0.4, ""],
    [26830, 46440, 0.45, ""],
    [46440, null, 0.5, ""]
  ]),
  municipalSurchargeRate: 0.07,
  socialContributionRate: 0.205,
  pensionContributionRate: 0.14,
  generalDeductionRate: 0,
  employerContributionRate: 0.25,
  employeeWithholdingRate: 0.25,
  personalTaxIdLabel: "Rijksregisternummer / Numéro national",
  businessRegIdLabel: "Ondernemingsnummer / Numéro d'entreprise",
  vatIdLabel: "BTW-nummer / Numéro de TVA",
  socialContribLabel: "Sociale bijdragen (INASTI/RSVZ)"
};

const DK: CountryProfileTemplate = {
  countryCode: "DK",
  countryName: "Denmark",
  templateFamily: "Nordic",
  templateVersion: "1.0.0",
  vatStandardRate: 0.25,
  vatRegistrationThreshold: 50000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 25,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 51400, 0.408, "Bottom bracket (incl. AM + municipal)"],
    [51400, null, 0.56, "Top bracket"]
  ]),
  municipalSurchargeRate: 0.253,
  socialContributionRate: 0.08,
  pensionContributionRate: 0,
  generalDeductionRate: 0,
  employerContributionRate: 0.08,
  employeeWithholdingRate: 0.41,
  personalTaxIdLabel: "CPR-nummer",
  businessRegIdLabel: "CVR-nummer",
  vatIdLabel: "Momsregistreringsnummer",
  socialContribLabel: "Arbejdsmarkedsbidrag (AM-bidrag)"
};

const FI: CountryProfileTemplate = {
  countryCode: "FI",
  countryName: "Finland",
  templateFamily: "Nordic",
  templateVersion: "1.0.0",
  vatStandardRate: 0.255,
  vatReducedRate1: 0.14,
  vatReducedRate2: 0.1,
  vatRegistrationThreshold: 15000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "monthly",
  vatPaymentDueDays: 12,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 20500, 0, ""],
    [20500, 30500, 0.12, ""],
    [30500, 50400, 0.21, ""],
    [50400, 88200, 0.3, ""],
    [88200, 150000, 0.34, ""],
    [150000, null, 0.44, ""]
  ]),
  municipalSurchargeRate: 0.0975,
  socialContributionRate: 0.218,
  pensionContributionRate: 0.245,
  generalDeductionRate: 0,
  employerContributionRate: 0.21,
  employeeWithholdingRate: 0.21,
  personalTaxIdLabel: "Henkilötunnus (HETU)",
  businessRegIdLabel: "Y-tunnus",
  vatIdLabel: "ALV-tunnus",
  socialContribLabel: "YEL-vakuutus (yrittäjien eläkevakuutus)"
};

const ES: CountryProfileTemplate = {
  countryCode: "ES",
  countryName: "Spain",
  templateFamily: "EU-South",
  templateVersion: "1.0.0",
  vatStandardRate: 0.21,
  vatReducedRate1: 0.1,
  vatReducedRate2: 0.04,
  vatRegistrationThreshold: 0,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 20,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 12450, 0.19, ""],
    [12450, 20200, 0.24, ""],
    [20200, 35200, 0.3, ""],
    [35200, 60000, 0.37, ""],
    [60000, 300000, 0.45, ""],
    [300000, null, 0.47, ""]
  ]),
  socialContributionRate: 0.311,
  pensionContributionRate: 0.283,
  generalDeductionRate: 0,
  employerContributionRate: 0.295,
  employeeWithholdingRate: 0.19,
  personalTaxIdLabel: "DNI / NIE",
  businessRegIdLabel: "NIF",
  vatIdLabel: "NIF-IVA",
  socialContribLabel: "Seguridad Social (RETA)"
};

const IT: CountryProfileTemplate = {
  countryCode: "IT",
  countryName: "Italy",
  templateFamily: "EU-South",
  templateVersion: "1.0.0",
  vatStandardRate: 0.22,
  vatReducedRate1: 0.1,
  vatReducedRate2: 0.05,
  vatReducedRate3: 0.04,
  vatRegistrationThreshold: 85000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 16,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 28000, 0.23, ""],
    [28000, 50000, 0.35, ""],
    [50000, null, 0.43, ""]
  ]),
  municipalSurchargeRate: 0.0233,
  socialContributionRate: 0.2572,
  pensionContributionRate: 0.24,
  generalDeductionRate: 0,
  employerContributionRate: 0.28,
  employeeWithholdingRate: 0.23,
  personalTaxIdLabel: "Codice fiscale",
  businessRegIdLabel: "Partita IVA",
  vatIdLabel: "Numero di partita IVA",
  socialContribLabel: "Contributi INPS (Gestione Separata)"
};

const PT: CountryProfileTemplate = {
  countryCode: "PT",
  countryName: "Portugal",
  templateFamily: "EU-South",
  templateVersion: "1.0.0",
  vatStandardRate: 0.23,
  vatReducedRate1: 0.13,
  vatReducedRate2: 0.06,
  vatRegistrationThreshold: 14500,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 15,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 7703, 0.1325, ""],
    [7703, 11623, 0.18, ""],
    [11623, 16472, 0.23, ""],
    [16472, 21321, 0.26, ""],
    [21321, 27146, 0.3275, ""],
    [27146, 39791, 0.37, ""],
    [39791, 51997, 0.435, ""],
    [51997, 81199, 0.45, ""],
    [81199, null, 0.48, ""]
  ]),
  socialContributionRate: 0.214,
  pensionContributionRate: 0.214,
  generalDeductionRate: 0,
  employerContributionRate: 0.2375,
  employeeWithholdingRate: 0.11,
  personalTaxIdLabel: "NIF (Número de Identificação Fiscal)",
  businessRegIdLabel: "NIPC",
  vatIdLabel: "NIF IVA",
  socialContribLabel: "Contribuições Segurança Social"
};

const GR: CountryProfileTemplate = {
  countryCode: "GR",
  countryName: "Greece",
  templateFamily: "EU-South",
  templateVersion: "1.0.0",
  vatStandardRate: 0.24,
  vatReducedRate1: 0.13,
  vatReducedRate2: 0.06,
  vatRegistrationThreshold: 10000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 26,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 10000, 0.09, ""],
    [10000, 20000, 0.22, ""],
    [20000, 30000, 0.28, ""],
    [30000, 40000, 0.36, ""],
    [40000, null, 0.44, ""]
  ]),
  socialContributionRate: 0.2668,
  pensionContributionRate: 0.2,
  generalDeductionRate: 0,
  employerContributionRate: 0.2183,
  employeeWithholdingRate: 0.16,
  personalTaxIdLabel: "ΑΦΜ (AFM)",
  businessRegIdLabel: "ΓΕΜΗ (GEMI)",
  vatIdLabel: "ΑΦΜ ΦΠΑ",
  socialContribLabel: "ΕΦΚΑ (EFKA)"
};

const IE: CountryProfileTemplate = {
  countryCode: "IE",
  countryName: "Ireland",
  templateFamily: "EU-West",
  templateVersion: "1.0.0",
  vatStandardRate: 0.23,
  vatReducedRate1: 0.135,
  vatReducedRate2: 0.09,
  vatRegistrationThreshold: 40000,
  vatCashAccounting: true,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 19,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 42000, 0.2, "Standard rate"],
    [42000, null, 0.4, "Higher rate"]
  ]),
  socialContributionRate: 0.04,
  pensionContributionRate: 0,
  generalDeductionRate: 0,
  employerContributionRate: 0.111,
  employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "PPSN",
  businessRegIdLabel: "Tax Reference Number",
  vatIdLabel: "VAT Registration Number",
  socialContribLabel: "PRSI (Pay Related Social Insurance)"
};

const LU: CountryProfileTemplate = {
  countryCode: "LU",
  countryName: "Luxembourg",
  templateFamily: "Benelux",
  templateVersion: "1.0.0",
  vatStandardRate: 0.17,
  vatReducedRate1: 0.14,
  vatReducedRate2: 0.08,
  vatReducedRate3: 0.03,
  vatRegistrationThreshold: 35000,
  vatCashAccounting: false,
  ossEnabled: true,
  reverseChargeEnabled: true,
  taxYearStartMonth: 1,
  taxYearEndMonth: 12,
  vatFilingFrequency: "quarterly",
  vatPaymentDueDays: 15,
  incomeTaxMode: "progressive",
  incomeTaxBands: progressive([
    [0, 12438, 0, ""],
    [12438, 20400, 0.08, ""],
    [20400, 26082, 0.1, ""],
    [26082, 31764, 0.12, ""],
    [31764, 37446, 0.14, ""],
    [37446, 43128, 0.16, ""],
    [43128, 48810, 0.18, ""],
    [48810, 54492, 0.2, ""],
    [54492, 60174, 0.22, ""],
    [60174, 65856, 0.24, ""],
    [65856, 71538, 0.26, ""],
    [71538, 77220, 0.28, ""],
    [77220, 82902, 0.3, ""],
    [82902, 88584, 0.32, ""],
    [88584, 94266, 0.34, ""],
    [94266, 99948, 0.36, ""],
    [99948, 105630, 0.38, ""],
    [105630, 200004, 0.39, ""],
    [200004, null, 0.42, ""]
  ]),
  socialContributionRate: 0.126,
  pensionContributionRate: 0.16,
  generalDeductionRate: 0,
  employerContributionRate: 0.15,
  employeeWithholdingRate: 0.15,
  personalTaxIdLabel: "Numéro national",
  businessRegIdLabel: "Numéro RCS",
  vatIdLabel: "Numéro d'identification TVA",
  socialContribLabel: "Cotisations sociales (CCSS)"
};

// ─── Remaining EU countries — concise template stubs ────────────────────────
// Full progressive band data included where rates are well-established.

const BG: CountryProfileTemplate = {
  countryCode: "BG", countryName: "Bulgaria", templateFamily: "EU-Flat", templateVersion: "1.0.0",
  vatStandardRate: 0.2, vatReducedRate1: 0.09, vatRegistrationThreshold: 100000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 14,
  incomeTaxMode: "flat", incomeTaxBands: [], flatIncomeTaxRate: 0.1,
  socialContributionRate: 0.1378, pensionContributionRate: 0.1282, generalDeductionRate: 0.25,
  employerContributionRate: 0.1788, employeeWithholdingRate: 0.1,
  personalTaxIdLabel: "ЕГН (EGN)", businessRegIdLabel: "ЕИК (EIK)", vatIdLabel: "ДДС номер", socialContribLabel: "Осигуровки"
};

const HR: CountryProfileTemplate = {
  countryCode: "HR", countryName: "Croatia", templateFamily: "EU-South", templateVersion: "1.0.0",
  vatStandardRate: 0.25, vatReducedRate1: 0.13, vatReducedRate2: 0.05, vatRegistrationThreshold: 40000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 20,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 50400, 0.2, ""], [50400, null, 0.3, ""]]),
  socialContributionRate: 0.2, pensionContributionRate: 0.2, generalDeductionRate: 0,
  employerContributionRate: 0.165, employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "OIB", businessRegIdLabel: "OIB", vatIdLabel: "PDV ID broj", socialContribLabel: "Doprinosi (HZMO/HZZO)"
};

const CY: CountryProfileTemplate = {
  countryCode: "CY", countryName: "Cyprus", templateFamily: "EU-Med", templateVersion: "1.0.0",
  vatStandardRate: 0.19, vatReducedRate1: 0.09, vatReducedRate2: 0.05, vatRegistrationThreshold: 15600,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "quarterly", vatPaymentDueDays: 10,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 19500, 0, ""], [19500, 28000, 0.2, ""], [28000, 36300, 0.25, ""], [36300, 60000, 0.3, ""], [60000, null, 0.35, ""]]),
  socialContributionRate: 0.0835, pensionContributionRate: 0.0835, generalDeductionRate: 0,
  employerContributionRate: 0.0835, employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "Tax Identification Code (TIC)", businessRegIdLabel: "Company Registration Number", vatIdLabel: "VAT Number", socialContribLabel: "Social Insurance"
};

const CZ: CountryProfileTemplate = {
  countryCode: "CZ", countryName: "Czechia", templateFamily: "EU-Central", templateVersion: "1.0.0",
  vatStandardRate: 0.21, vatReducedRate1: 0.15, vatReducedRate2: 0.1, vatRegistrationThreshold: 2000000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 25,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 1935552, 0.15, ""], [1935552, null, 0.23, ""]]),
  socialContributionRate: 0.292, pensionContributionRate: 0.28, generalDeductionRate: 0,
  employerContributionRate: 0.245, employeeWithholdingRate: 0.15,
  personalTaxIdLabel: "Rodné číslo", businessRegIdLabel: "IČO / DIČ", vatIdLabel: "DIČ (DPH)", socialContribLabel: "Sociální a zdravotní pojištění"
};

const EE: CountryProfileTemplate = {
  countryCode: "EE", countryName: "Estonia", templateFamily: "Baltic", templateVersion: "1.0.0",
  vatStandardRate: 0.22, vatReducedRate1: 0.09, vatRegistrationThreshold: 40000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 20,
  incomeTaxMode: "flat", incomeTaxBands: [], flatIncomeTaxRate: 0.22,
  socialContributionRate: 0.13, pensionContributionRate: 0.02, generalDeductionRate: 0,
  employerContributionRate: 0.33, employeeWithholdingRate: 0.22,
  personalTaxIdLabel: "Isikukood", businessRegIdLabel: "Registrikood", vatIdLabel: "KMKR number", socialContribLabel: "Sotsiaalmaks"
};

const HU: CountryProfileTemplate = {
  countryCode: "HU", countryName: "Hungary", templateFamily: "EU-Flat", templateVersion: "1.0.0",
  vatStandardRate: 0.27, vatReducedRate1: 0.18, vatReducedRate2: 0.05, vatRegistrationThreshold: 12000000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 20,
  incomeTaxMode: "flat", incomeTaxBands: [], flatIncomeTaxRate: 0.15,
  socialContributionRate: 0.185, pensionContributionRate: 0.1, generalDeductionRate: 0,
  employerContributionRate: 0.13, employeeWithholdingRate: 0.15,
  personalTaxIdLabel: "Adóazonosító jel", businessRegIdLabel: "Adószám", vatIdLabel: "ÁFA-szám", socialContribLabel: "Társadalombiztosítási járulék"
};

const LV: CountryProfileTemplate = {
  countryCode: "LV", countryName: "Latvia", templateFamily: "Baltic", templateVersion: "1.0.0",
  vatStandardRate: 0.21, vatReducedRate1: 0.12, vatReducedRate2: 0.05, vatRegistrationThreshold: 50000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 20,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 20004, 0.2, ""], [20004, 78100, 0.23, ""], [78100, null, 0.31, ""]]),
  socialContributionRate: 0.107, pensionContributionRate: 0.107, generalDeductionRate: 0,
  employerContributionRate: 0.2359, employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "Personas kods", businessRegIdLabel: "Reģistrācijas numurs", vatIdLabel: "PVN reģistrācijas numurs", socialContribLabel: "Valsts sociālās apdrošināšanas obligātās iemaksas"
};

const LT: CountryProfileTemplate = {
  countryCode: "LT", countryName: "Lithuania", templateFamily: "Baltic", templateVersion: "1.0.0",
  vatStandardRate: 0.21, vatReducedRate1: 0.09, vatReducedRate2: 0.05, vatRegistrationThreshold: 45000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 25,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 101094, 0.2, ""], [101094, null, 0.32, ""]]),
  socialContributionRate: 0.126, pensionContributionRate: 0.065, generalDeductionRate: 0,
  employerContributionRate: 0.0178, employeeWithholdingRate: 0.2,
  personalTaxIdLabel: "Asmens kodas", businessRegIdLabel: "Mokesčių mokėtojo kodas", vatIdLabel: "PVM mokėtojo kodas", socialContribLabel: "Valstybinio socialinio draudimo įmokos"
};

const MT: CountryProfileTemplate = {
  countryCode: "MT", countryName: "Malta", templateFamily: "EU-Med", templateVersion: "1.0.0",
  vatStandardRate: 0.18, vatReducedRate1: 0.07, vatReducedRate2: 0.05, vatRegistrationThreshold: 35000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "quarterly", vatPaymentDueDays: 15,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 9100, 0, ""], [9100, 14500, 0.15, ""], [14500, 19500, 0.25, ""], [19500, null, 0.35, ""]]),
  socialContributionRate: 0.1, pensionContributionRate: 0.1, generalDeductionRate: 0,
  employerContributionRate: 0.1, employeeWithholdingRate: 0.15,
  personalTaxIdLabel: "Identity Card Number", businessRegIdLabel: "PE Number", vatIdLabel: "VAT Number", socialContribLabel: "Social Security Contributions"
};

const RO: CountryProfileTemplate = {
  countryCode: "RO", countryName: "Romania", templateFamily: "EU-Flat", templateVersion: "1.0.0",
  vatStandardRate: 0.19, vatReducedRate1: 0.09, vatReducedRate2: 0.05, vatRegistrationThreshold: 300000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 25,
  incomeTaxMode: "flat", incomeTaxBands: [], flatIncomeTaxRate: 0.1,
  socialContributionRate: 0.25, pensionContributionRate: 0.25, generalDeductionRate: 0,
  employerContributionRate: 0.025, employeeWithholdingRate: 0.1,
  personalTaxIdLabel: "CNP", businessRegIdLabel: "CUI / CIF", vatIdLabel: "Cod TVA", socialContribLabel: "CAS / CASS"
};

const SK: CountryProfileTemplate = {
  countryCode: "SK", countryName: "Slovakia", templateFamily: "EU-Central", templateVersion: "1.0.0",
  vatStandardRate: 0.2, vatReducedRate1: 0.1, vatRegistrationThreshold: 49790,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 25,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 47537, 0.19, ""], [47537, null, 0.25, ""]]),
  socialContributionRate: 0.14, pensionContributionRate: 0.18, generalDeductionRate: 0,
  employerContributionRate: 0.351, employeeWithholdingRate: 0.19,
  personalTaxIdLabel: "Rodné číslo", businessRegIdLabel: "IČO / DIČ", vatIdLabel: "IČ DPH", socialContribLabel: "Odvody do SP a ZP"
};

const SI: CountryProfileTemplate = {
  countryCode: "SI", countryName: "Slovenia", templateFamily: "EU-Central", templateVersion: "1.0.0",
  vatStandardRate: 0.22, vatReducedRate1: 0.095, vatRegistrationThreshold: 50000,
  vatCashAccounting: false, ossEnabled: true, reverseChargeEnabled: true,
  taxYearStartMonth: 1, taxYearEndMonth: 12, vatFilingFrequency: "monthly", vatPaymentDueDays: 20,
  incomeTaxMode: "progressive", incomeTaxBands: progressive([[0, 8755, 0.16, ""], [8755, 25842, 0.26, ""], [25842, 51678, 0.33, ""], [51678, 74160, 0.39, ""], [74160, null, 0.5, ""]]),
  socialContributionRate: 0.231, pensionContributionRate: 0.155, generalDeductionRate: 0,
  employerContributionRate: 0.161, employeeWithholdingRate: 0.22,
  personalTaxIdLabel: "Davčna številka", businessRegIdLabel: "Matična številka", vatIdLabel: "ID za DDV", socialContribLabel: "Prispevki za socialno varnost"
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const COUNTRY_PROFILES: Record<string, CountryProfileTemplate> = {
  SE, GB, DE, FR, NL, PL,
  AT, BE, BG, CY, CZ, DK,
  EE, ES, FI, GR, HR, HU,
  IE, IT, LT, LU, LV, MT,
  PT, RO, SI, SK
};

export function getCountryProfile(countryCode: string): CountryProfileTemplate | undefined {
  return COUNTRY_PROFILES[countryCode.toUpperCase()];
}

export function listCountryProfiles(): CountryProfileTemplate[] {
  return Object.values(COUNTRY_PROFILES).sort((a, b) =>
    a.countryName.localeCompare(b.countryName)
  );
}
