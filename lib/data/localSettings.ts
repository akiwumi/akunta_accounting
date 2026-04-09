import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LocalBusinessSettings = {
  name: string;
  jurisdiction: string;
  locale: string;
  baseCurrency: string;
  bookkeepingMethod: string;
  vatRegistered: boolean;
  vatFrequency: string;
  fiscalYearStartMonth: number;
  sniCode?: string;
  vatNumber?: string;
  fSkattRegistered?: boolean;
  personnummer?: string;
  invoiceNumberPattern?: string;
  invoiceSenderName?: string;
  invoiceSenderAddress?: string;
  invoiceSenderOrgNumber?: string;
  invoiceSenderEmail?: string;
  invoiceSenderPhone?: string;
  invoiceSenderWebsite?: string;
  invoiceEmailFrom?: string;
  invoiceDefaultLogo?: string;
  invoiceDefaultSignature?: string;
  municipalTaxRate?: number;
  socialContributionRate?: number;
  generalDeductionRate?: number;
};

const LEGACY_LOCAL_SETTINGS_PATH = path.join(process.cwd(), "data", "local-settings.json");
const PROJECT_LOCAL_SETTINGS_PATH = path.join(process.cwd(), "data", "local-settings.local.json");
const TEMP_LOCAL_SETTINGS_PATH = path.join(os.tmpdir(), "akunta", "local-settings.json");
const CUSTOM_LOCAL_SETTINGS_PATH = process.env.LOCAL_SETTINGS_PATH?.trim();

const LOCAL_SETTINGS_WRITE_PATHS = Array.from(
  new Set(
    [CUSTOM_LOCAL_SETTINGS_PATH, PROJECT_LOCAL_SETTINGS_PATH, TEMP_LOCAL_SETTINGS_PATH].filter(
      (value): value is string => Boolean(value)
    )
  )
);

const LOCAL_SETTINGS_READ_PATHS = Array.from(
  new Set(
    [
      CUSTOM_LOCAL_SETTINGS_PATH,
      PROJECT_LOCAL_SETTINGS_PATH,
      TEMP_LOCAL_SETTINGS_PATH,
      LEGACY_LOCAL_SETTINGS_PATH
    ].filter((value): value is string => Boolean(value))
  )
);

type LocalSettingsFile = {
  updatedAt: string;
  settings: LocalBusinessSettings;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTimestamp = (value: string | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSettings = (value: unknown): LocalBusinessSettings | null => {
  if (!isObject(value)) return null;

  return {
    name: typeof value.name === "string" ? value.name : "",
    jurisdiction: typeof value.jurisdiction === "string" ? value.jurisdiction : "SWEDEN",
    locale: typeof value.locale === "string" ? value.locale : "en",
    baseCurrency: typeof value.baseCurrency === "string" ? value.baseCurrency : "SEK",
    bookkeepingMethod: typeof value.bookkeepingMethod === "string" ? value.bookkeepingMethod : "kontantmetoden",
    vatRegistered: typeof value.vatRegistered === "boolean" ? value.vatRegistered : true,
    vatFrequency: typeof value.vatFrequency === "string" ? value.vatFrequency : "yearly",
    fiscalYearStartMonth: Math.min(12, Math.max(1, Math.trunc(toNumber(value.fiscalYearStartMonth, 1)))),
    sniCode: typeof value.sniCode === "string" ? value.sniCode : "",
    vatNumber: typeof value.vatNumber === "string" ? value.vatNumber : "",
    fSkattRegistered: typeof value.fSkattRegistered === "boolean" ? value.fSkattRegistered : true,
    personnummer: typeof value.personnummer === "string" ? value.personnummer : "",
    invoiceNumberPattern:
      typeof value.invoiceNumberPattern === "string" ? value.invoiceNumberPattern : "INV-{YYYY}-{SEQ:4}",
    invoiceSenderName: typeof value.invoiceSenderName === "string" ? value.invoiceSenderName : "",
    invoiceSenderAddress: typeof value.invoiceSenderAddress === "string" ? value.invoiceSenderAddress : "",
    invoiceSenderOrgNumber: typeof value.invoiceSenderOrgNumber === "string" ? value.invoiceSenderOrgNumber : "",
    invoiceSenderEmail: typeof value.invoiceSenderEmail === "string" ? value.invoiceSenderEmail : "",
    invoiceSenderPhone: typeof value.invoiceSenderPhone === "string" ? value.invoiceSenderPhone : "",
    invoiceSenderWebsite: typeof value.invoiceSenderWebsite === "string" ? value.invoiceSenderWebsite : "",
    invoiceEmailFrom: typeof value.invoiceEmailFrom === "string" ? value.invoiceEmailFrom : "",
    invoiceDefaultLogo: typeof value.invoiceDefaultLogo === "string" ? value.invoiceDefaultLogo : "",
    invoiceDefaultSignature: typeof value.invoiceDefaultSignature === "string" ? value.invoiceDefaultSignature : "",
    municipalTaxRate: toNumber(value.municipalTaxRate, 0.32),
    socialContributionRate: toNumber(value.socialContributionRate, 0.2897),
    generalDeductionRate: toNumber(value.generalDeductionRate, 0.25)
  };
};

export const writeLocalSettings = async (settings: LocalBusinessSettings) => {
  const payload: LocalSettingsFile = {
    updatedAt: new Date().toISOString(),
    settings
  };

  const serialized = JSON.stringify(payload, null, 2);
  const failures: string[] = [];

  for (const localSettingsPath of LOCAL_SETTINGS_WRITE_PATHS) {
    try {
      await fs.mkdir(path.dirname(localSettingsPath), { recursive: true });
      await fs.writeFile(localSettingsPath, serialized, "utf8");
      return;
    } catch (error) {
      failures.push(
        `${localSettingsPath}: ${error instanceof Error ? error.message : "Unknown write failure"}`
      );
    }
  }

  throw new Error(`Failed to write local settings. ${failures.join(" | ")}`);
};

export const readLocalSettings = async (): Promise<LocalBusinessSettings | null> => {
  let newestMatch: { settings: LocalBusinessSettings; updatedAt: number } | null = null;

  for (const localSettingsPath of LOCAL_SETTINGS_READ_PATHS) {
    try {
      const raw = await fs.readFile(localSettingsPath, "utf8");
      const parsed: unknown = JSON.parse(raw);

      if (isObject(parsed) && "settings" in parsed) {
        const settings = normalizeSettings(parsed.settings);
        if (!settings) continue;

        const candidate = {
          settings,
          updatedAt: toTimestamp(typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined)
        };

        if (!newestMatch || candidate.updatedAt >= newestMatch.updatedAt) {
          newestMatch = candidate;
        }

        continue;
      }

      const settings = normalizeSettings(parsed);
      if (!settings) continue;

      const candidate = { settings, updatedAt: 0 };
      if (!newestMatch || candidate.updatedAt >= newestMatch.updatedAt) {
        newestMatch = candidate;
      }
    } catch {
      continue;
    }
  }

  return newestMatch?.settings ?? null;
};

export const mergeBusinessWithLocalSettings = <T extends { [key: string]: unknown }>(
  business: T,
  local: LocalBusinessSettings | null
): T => {
  if (!local) return business;

  const merged = {
    ...business,
    name: local.name || String((business as { name?: unknown }).name ?? ""),
    jurisdiction: local.jurisdiction,
    locale: local.locale,
    baseCurrency: local.baseCurrency,
    bookkeepingMethod: local.bookkeepingMethod,
    vatRegistered: local.vatRegistered,
    vatFrequency: local.vatFrequency,
    sniCode: local.sniCode || null,
    vatNumber: local.vatNumber || null,
    fSkattRegistered: local.fSkattRegistered ?? true,
    personnummer: local.personnummer || null,
    invoiceNumberPattern: local.invoiceNumberPattern || "INV-{YYYY}-{SEQ:4}",
    invoiceSenderName: local.invoiceSenderName || null,
    invoiceSenderAddress: local.invoiceSenderAddress || null,
    invoiceSenderOrgNumber: local.invoiceSenderOrgNumber || null,
    invoiceSenderEmail: local.invoiceSenderEmail || null,
    invoiceSenderPhone: local.invoiceSenderPhone || null,
    invoiceSenderWebsite: local.invoiceSenderWebsite || null,
    invoiceEmailFrom: local.invoiceEmailFrom || null,
    invoiceDefaultLogo: local.invoiceDefaultLogo || null,
    invoiceDefaultSignature: local.invoiceDefaultSignature || null,
    fiscalYearStart: new Date(Date.UTC(2000, local.fiscalYearStartMonth - 1, 1, 0, 0, 0, 0))
  } as T;

  const mergedRecord = merged as Record<string, unknown>;
  const maybeTaxConfig = mergedRecord.taxConfig;
  if (maybeTaxConfig && typeof maybeTaxConfig === "object") {
    mergedRecord.taxConfig = {
      ...(maybeTaxConfig as Record<string, unknown>),
      municipalTaxRate: local.municipalTaxRate ?? (maybeTaxConfig as Record<string, unknown>).municipalTaxRate,
      socialContributionRate:
        local.socialContributionRate ?? (maybeTaxConfig as Record<string, unknown>).socialContributionRate,
      generalDeductionRate:
        local.generalDeductionRate ?? (maybeTaxConfig as Record<string, unknown>).generalDeductionRate
    };
  }

  return merged;
};
