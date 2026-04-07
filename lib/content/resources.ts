export type Resource = {
  title: string;
  description: string;
  url: string;
  category: string;
  /** ISO 3166-1 alpha-2 country codes this resource applies to, or null for all */
  countries: string[] | null;
};

export const resources: Resource[] = [
  // ─── Sweden ──────────────────────────────────────────────────────────────────
  {
    title: "Skatteverket — Income tax return (Inkomstdeklaration)",
    description: "File your personal and business income tax return online via Skatteverket's portal.",
    url: "https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomstdeklaration.html",
    category: "Tax Filing",
    countries: ["SE"]
  },
  {
    title: "Skatteverket — VAT (Momsdeklaration)",
    description: "Guide to Swedish VAT registration, rates, and filing your momsdeklaration.",
    url: "https://www.skatteverket.se/foretag/moms.html",
    category: "VAT",
    countries: ["SE"]
  },
  {
    title: "Skatteverket — Employer obligations (Arbetsgivaravgifter)",
    description: "Information on employer contributions, PAYE, and the monthly employer declaration.",
    url: "https://www.skatteverket.se/foretag/arbetsgivare.html",
    category: "Payroll",
    countries: ["SE"]
  },
  {
    title: "Bolagsverket — Sole trader registration",
    description: "Register or update your enskild firma with the Swedish Companies Registration Office.",
    url: "https://www.bolagsverket.se/foretag/enskild-naringsidkare",
    category: "Business Registration",
    countries: ["SE"]
  },
  {
    title: "Skatteverket — F-skatt registration",
    description: "Apply for F-skatt approval so customers don't need to deduct tax from your invoices.",
    url: "https://www.skatteverket.se/foretag/skatter/foretagsregistrering/f-skatt.html",
    category: "Tax Filing",
    countries: ["SE"]
  },
  {
    title: "Verksamt.se — Starting a business",
    description: "Sweden's government portal for starting, running, and closing a business.",
    url: "https://www.verksamt.se/",
    category: "Business Registration",
    countries: ["SE"]
  },
  {
    title: "FAR — Swedish accounting standards (K2/K3)",
    description: "Overview of the K2 and K3 frameworks used by Swedish small and medium businesses.",
    url: "https://www.far.se/",
    category: "Accounting Standards",
    countries: ["SE"]
  },
  // ─── European Union ───────────────────────────────────────────────────────────
  {
    title: "European Commission — VAT rules for digital services",
    description: "EU VAT rules including OSS/IOSS for businesses selling digital services across borders.",
    url: "https://ec.europa.eu/taxation_customs/business/vat/digital-services_en",
    category: "VAT",
    countries: null
  },
  {
    title: "EUR-Lex — EU accounting directives",
    description: "The EU Accounting Directive and related regulations applicable to member-state businesses.",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32013L0034",
    category: "Accounting Standards",
    countries: null
  },
  // ─── General / all countries ─────────────────────────────────────────────────
  {
    title: "OECD — Transfer pricing guidelines",
    description: "International guidelines on transfer pricing for businesses operating across borders.",
    url: "https://www.oecd.org/tax/transfer-pricing/",
    category: "International Tax",
    countries: null
  }
];

export function getResourcesByCountry(countryCode: string | null): Resource[] {
  if (!countryCode) return resources;
  return resources.filter(
    (r) => r.countries === null || r.countries.includes(countryCode.toUpperCase())
  );
}

export function getResourceCategories(): string[] {
  return [...new Set(resources.map((r) => r.category))].sort();
}
