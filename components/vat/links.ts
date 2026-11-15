/** Skatteverket pages the VAT flow links to. Read 2026-11-15. */
export const SKV_LINKS = {
  /** "Deklarera moms": the way in to the e-service "Lämna momsdeklaration". */
  declare: "https://www.skatteverket.se/foretag/moms/deklareramoms.4.7459477810df5bccdd480006935.html",
  fileGuide:
    "https://www.skatteverket.se/foretag/moms/deklareramoms/skapaochskickainmomsdeklarationviafil.4.2fb39afe18dabf1e4d223cc.html",
  boxes: "https://www.skatteverket.se/foretag/moms/deklareramoms/fyllaimomsdeklarationen.4.3a2a542410ab40a421c80004214.html",
  deadlines:
    "https://www.skatteverket.se/foretag/moms/deklareramoms/narskajagdeklareramoms.4.6d02084411db6e252fe80008988.html",
  correct: "https://www.skatteverket.se/foretag/moms/deklareramoms/rattaenmomsdeklaration.4.3684199413c956649b552c4.html"
} as const;

export const vatHref = (periodKey: string, step: "check" | "review" | "file") =>
  `/vat?period=${encodeURIComponent(periodKey)}&step=${step}#flow`;
