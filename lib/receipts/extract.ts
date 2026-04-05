import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import { createWorker } from "tesseract.js";
import { z } from "zod";

const execFile = promisify(execFileCallback);

const extractedReceiptSchema = z.object({
  receiptNumber: z.string().optional(),
  vendor: z.string().optional(),
  issueDate: z.string().optional(),
  receiptDate: z.string().optional(),
  grossAmount: z.number().positive().optional(),
  netAmount: z.number().nonnegative().optional(),
  vatAmount: z.number().nonnegative().optional(),
  currency: z
    .string()
    .trim()
    .transform((value) => (/^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : "SEK"))
    .default("SEK"),
  vatRate: z.number().min(0).max(1).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.4),
  needsReview: z.boolean().default(true)
});

export type ExtractedReceipt = z.infer<typeof extractedReceiptSchema>;

type AmountToken = {
  raw: string;
  start: number;
  end: number;
  value: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

const extractJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find JSON object in model response.");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const getOutputText = (response: any): string => {
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }

  if (Array.isArray(response.output)) {
    const chunks: string[] = [];
    for (const outputItem of response.output) {
      if (!Array.isArray(outputItem.content)) continue;
      for (const content of outputItem.content) {
        if (typeof content?.text === "string") chunks.push(content.text);
      }
    }
    if (chunks.length > 0) return chunks.join("\n");
  }

  return "";
};

const normalizeSpace = (value: string) =>
  value
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const parseAmountString = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d,.\- ]/g, "").trim();
  if (!cleaned) return null;

  let normalized = cleaned.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return round2(parsed);
};

const amountRegex = /-?\d[\d .]*[,.]\d{2}/g;

const extractAmountTokens = (text: string): AmountToken[] => {
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(amountRegex)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const value = parseAmountString(raw);
    if (value === null || value <= 0 || value > 1_000_000) continue;
    tokens.push({
      raw,
      start,
      end: start + raw.length,
      value
    });
  }
  return tokens;
};

const tokenLooksLikePercent = (text: string, token: AmountToken) => {
  const after = text.slice(token.end, token.end + 4);
  const before = text.slice(Math.max(0, token.start - 1), token.start);
  return after.includes("%") || before.includes("%");
};

const tokenHasCurrencyNear = (text: string, token: AmountToken) => {
  const window = text.slice(Math.max(0, token.start - 6), Math.min(text.length, token.end + 8)).toLowerCase();
  return /(?:kr|sek|eur|gbp|usd|dkk|nok|isk|cad|aud|nzd|chf|jpy|cny|zar|pln|czk|huf|ron|hrk|try|brl|mxn|inr|thb|sgd|hkd|aed|sar|qar|€|£|\$)/i.test(
    window
  );
};

const findKeywordSpans = (text: string, keyword: RegExp, range = 120) => {
  const spans: Array<{ start: number; end: number }> = [];
  const flags = keyword.flags.includes("g") ? keyword.flags : `${keyword.flags}g`;
  const global = new RegExp(keyword.source, flags);
  for (const match of text.matchAll(global)) {
    const index = match.index ?? 0;
    spans.push({
      start: Math.max(0, index - 16),
      end: Math.min(text.length, index + range)
    });
  }
  return spans;
};

const pickAmountNearKeyword = (
  text: string,
  tokens: AmountToken[],
  keyword: RegExp,
  opts?: {
    preferSmallest?: boolean;
    maxValue?: number;
  }
): number | undefined => {
  const spans = findKeywordSpans(text, keyword);
  const inRange = tokens.filter((token) =>
    spans.some((span) => token.start >= span.start && token.end <= span.end)
  );
  const clean = inRange
    .filter((token) => !tokenLooksLikePercent(text, token))
    .filter((token) => (opts?.maxValue ? token.value <= opts.maxValue : true));
  if (clean.length === 0) return undefined;

  const sorted = [...clean].sort((a, b) => (opts?.preferSmallest ? a.value - b.value : b.value - a.value));
  return sorted[0].value;
};

const pickCurrency = (text: string): string => {
  const lower = text.toLowerCase();
  if (/€|\beur\b/.test(lower)) return "EUR";
  if (/£|\bgbp\b/.test(lower)) return "GBP";
  if (/\b(?:usd|us\$)\b|\$/.test(lower) && !/\b(?:aud|cad|nzd|sgd|hkd)\b/.test(lower)) return "USD";
  if (/\bchf\b|fr\.?\s*$/.test(lower)) return "CHF";
  if (/\bdkk\b/.test(lower)) return "DKK";
  if (/\bnok\b/.test(lower)) return "NOK";
  if (/\bisk\b/.test(lower)) return "ISK";
  if (/\bcad\b/.test(lower)) return "CAD";
  if (/\baud\b/.test(lower)) return "AUD";
  if (/\bnzd\b/.test(lower)) return "NZD";
  if (/\bjpy\b|¥/.test(lower)) return "JPY";
  if (/\bcny\b|\brmb\b/.test(lower)) return "CNY";
  if (/\bpln\b/.test(lower)) return "PLN";
  if (/\bczk\b/.test(lower)) return "CZK";
  if (/\bhuf\b/.test(lower)) return "HUF";
  if (/\bsgd\b/.test(lower)) return "SGD";
  if (/\bhkd\b/.test(lower)) return "HKD";

  const isoMatch = lower.match(/\b([a-z]{3})\b/g);
  if (isoMatch) {
    const denyList = new Set(["vat", "moms", "tot", "sum", "org", "www", "com"]);
    for (const token of isoMatch) {
      if (!denyList.has(token)) return token.toUpperCase();
    }
  }

  return "SEK";
};

const monthMap: Record<string, string> = {
  jan: "01",
  januari: "01",
  january: "01",
  feb: "02",
  februari: "02",
  february: "02",
  mar: "03",
  mars: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  maj: "05",
  jun: "06",
  juni: "06",
  june: "06",
  jul: "07",
  juli: "07",
  july: "07",
  aug: "08",
  augusti: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  okt: "10",
  oktober: "10",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};

const pad2 = (value: string | number) => String(value).padStart(2, "0");

const monthToNumber = (rawMonth: string): string | undefined => {
  const key = rawMonth.toLowerCase().replace(/[^a-zåäö]/gi, "");
  return monthMap[key];
};

const toIsoDate = (input: string): string | undefined => {
  const normalized = input.trim();
  const yyyyMmDd = normalized.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (yyyyMmDd) {
    const [, year, month, day] = yyyyMmDd;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const ddMmYyyy = normalized.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (ddMmYyyy) {
    const [, day, month, year] = ddMmYyyy;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const monthFirst = normalized.match(/\b([A-Za-zÅÄÖåäö]{3,12})\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (monthFirst) {
    const [, monthRaw, day, year] = monthFirst;
    const month = monthToNumber(monthRaw);
    if (month) return `${year}-${month}-${pad2(day)}`;
  }

  const dayFirst = normalized.match(/\b(\d{1,2})\s+([A-Za-zÅÄÖåäö]{3,12})\s+(20\d{2})\b/);
  if (dayFirst) {
    const [, day, monthRaw, year] = dayFirst;
    const month = monthToNumber(monthRaw);
    if (month) return `${year}-${month}-${pad2(day)}`;
  }

  return undefined;
};

const extractIssueDate = (text: string): string | undefined => {
  const lines = text
    .split("\n")
    .map((line) => normalizeSpace(line))
    .filter(Boolean);

  const dateKeywordRegex =
    /(fakturadatum|invoice date|issue date|receipt date|datum|date|created|utställd|utfärdad|time|tid)[^\n]{0,72}/gi;
  for (const match of text.matchAll(dateKeywordRegex)) {
    const iso = toIsoDate(match[0]);
    if (iso) return iso;
  }

  for (const line of lines) {
    const iso = toIsoDate(line);
    if (iso) return iso;
  }

  const allDateRegex = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/g;
  const first = [...text.matchAll(allDateRegex)][0]?.[0];
  return first ? toIsoDate(first) : undefined;
};

const companySuffixes = new Set(["AB", "KB", "HB", "LTD", "LLC", "GMBH", "AS", "OY"]);

const toTitle = (value: string) =>
  value
    .replace(/[._]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const clean = part.replace(/^[^A-Za-zÅÄÖåäö0-9]+|[^A-Za-zÅÄÖåäö0-9]+$/g, "");
      if (!clean) return "";
      const upper = clean.toUpperCase();
      if (companySuffixes.has(upper)) return upper;
      if (/^[A-Z]{2,}\d+$/.test(clean)) return clean;
      return clean.slice(0, 1).toUpperCase() + clean.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(" ");

const blockedEmailDomains = new Set(["gmail.com", "hotmail.com", "outlook.com", "icloud.com"]);

const isAddressLike = (value: string) =>
  /\b\d{3}\s?\d{2}\b/.test(value) ||
  /\b(?:gata|gatan|väg|vag|vägen|road|street|avenue|ave|lgh|box)\b/i.test(value);

const vendorNoise = /^(customer invoice copy|kontantfaktura|cashier|customer|company cvr|company name|name|address|zip|city|phone|time|pick up time|shopno|reglid|regno|order-id|sequenceid|din faktura|faktura|invoice|månadsavi|belopp|förfallodag|plusgiro|bankgiro|mottagare|ocr|kontonr|sida|kontaktperson|fakturaspecifikation|benämning|antal|à-pris|moms|totalt belopp|frågor|händelser|ingående saldo|betalning|utgående saldo|lägsta belopp att betala|vilkommen|signature)/i;

const cleanVendor = (value: string) => normalizeSpace(value.replace(/^[#>:_-]+|[#>:_-]+$/g, ""));

const isGoodVendorCandidate = (value: string) => {
  const candidate = cleanVendor(value);
  if (candidate.length < 3 || candidate.length > 80) return false;
  if (vendorNoise.test(candidate)) return false;
  if (/@/.test(candidate)) return false;
  if (/^se\d{8,}/i.test(candidate)) return false;
  if (/^\d+$/.test(candidate)) return false;
  if (/^[\d\s\-.,]+$/.test(candidate)) return false;
  if (isAddressLike(candidate)) return false;
  if (!/[a-zåäö]/i.test(candidate)) return false;
  return true;
};

const extractVendor = (text: string, fileName: string): string | undefined => {
  const lines = text
    .split("\n")
    .map((line) => normalizeSpace(line))
    .filter(Boolean);

  const candidates: Array<{ value: string; score: number; index: number }> = [];
  const pushCandidate = (value: string, score: number, index: number) => {
    const cleaned = cleanVendor(value);
    if (!isGoodVendorCandidate(cleaned)) return;
    candidates.push({ value: cleaned, score, index });
  };

  const labelPattern = /^(fordringsägare|vendor|seller|merchant|leverantör|mottagare|butik|store)\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;

    const inlineValue = line.replace(labelPattern, "").replace(/^[:\- ]+/, "").trim();
    if (inlineValue) pushCandidate(inlineValue, 10, index);

    for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
      const next = lines[index + lookahead];
      if (!next) break;
      pushCandidate(next, 9 - lookahead, index + lookahead);
    }
  }

  const emailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)];
  for (const match of emailMatches) {
    const domain = (match[1] || "").toLowerCase().replace(/^www\./, "");
    if (!domain || blockedEmailDomains.has(domain)) continue;
    const root = domain.split(".")[0];
    if (!root) continue;
    const score = /(bank|finance|payments)/i.test(root) ? 4 : 6;
    pushCandidate(root, score, 999);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isGoodVendorCandidate(line)) continue;
    let score = 1;
    if (/\b(?:ab|ltd|llc|gmbh|bank|photo|studio|solutions|agency|group)\b/i.test(line)) score += 6;
    if (line.length <= 35) score += 1;
    pushCandidate(line, score, index);
  }

  const ranked = candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  if (best) {
    const nonBank = ranked.find((candidate) => !/\bbank\b/i.test(candidate.value));
    if (/\bbank\b/i.test(best.value) && nonBank && nonBank.score >= best.score - 1) {
      return toTitle(nonBank.value);
    }
    return toTitle(best.value);
  }

  const fromFile = basename(fileName, extname(fileName))
    .replace(/[_-]+/g, " ")
    .replace(/\b\d+\b/g, "")
    .trim();
  return fromFile.length > 2 ? toTitle(fromFile) : undefined;
};

const extractReceiptNumber = (text: string): string | undefined => {
  const lines = text
    .split("\n")
    .map((line) => normalizeSpace(line))
    .filter(Boolean);
  const blockedContext = /(organisationsnummer|org(?:anisations)?\s*nr|momsregistreringsnummer|vat)/i;
  const normalizeRef = (value: string) =>
    value.replace(/[^\dA-Za-z-]/g, "").replace(/^-+|-+$/g, "");
  const isValidRef = (value: string) =>
    value.length >= 5 &&
    value.length <= 36 &&
    /\d/.test(value) &&
    !/^SE\d{8,}$/i.test(value);

  const keywordPattern =
    /(?:fakturanummer|invoice\s*(?:number|no\.?)|kvittonummer|receipt\s*(?:number|no\.?)|transaktionsreferens|transaction\s*reference|order[- ]?id|ocr(?:-?referens)?|referens)\s*[:#]?\s*([A-Z0-9][A-Z0-9\- ]{4,})/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (blockedContext.test(line)) continue;

    const keywordMatch = line.match(keywordPattern);
    const inlineValue = keywordMatch?.[1] ? normalizeRef(keywordMatch[1]) : "";
    if (inlineValue && isValidRef(inlineValue)) return inlineValue;

    if (/(fakturanummer|receipt|kvitto|ocr|referens|transaction|order)/i.test(line)) {
      const next = lines[index + 1];
      if (next && !blockedContext.test(next)) {
        const rawRef = next.match(/\b[A-Z0-9][A-Z0-9\- ]{4,}\b/i)?.[0] ?? "";
        const nextValue = normalizeRef(rawRef);
        if (nextValue && isValidRef(nextValue)) return nextValue;
      }
    }
  }

  for (const line of lines) {
    if (blockedContext.test(line)) continue;
    const value = line.match(/\b\d{5,}-\d{4,}\b/)?.[0];
    if (value && isValidRef(value)) return value;
  }

  for (const line of lines) {
    if (blockedContext.test(line)) continue;
    const value = line.match(/\b\d{10,20}\b/)?.[0];
    if (value && isValidRef(value)) return value;
  }

  return undefined;
};

const extractVatAmount = (text: string, grossAmount?: number, vatRate?: number): number | undefined => {
  const lines = text.split("\n");
  const candidates: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(moms|vat)/i.test(line)) continue;

    const currentLineTokens = extractAmountTokens(line).filter((token) => !tokenLooksLikePercent(line, token));
    for (const token of currentLineTokens) {
      candidates.push(token.value);
    }

    const nextLine = lines[index + 1];
    if (nextLine) {
      const nextLineTokens = extractAmountTokens(nextLine).filter((token) => !tokenLooksLikePercent(nextLine, token));
      for (const token of nextLineTokens) {
        candidates.push(token.value);
      }
    }
  }

  if (candidates.length === 0) return undefined;
  let filtered = candidates.filter((candidate) => candidate > 0);

  if (grossAmount) {
    filtered = filtered.filter((candidate) => candidate < grossAmount && candidate <= grossAmount * 0.5);
    if (filtered.length === 0) return undefined;
  }

  if (grossAmount && vatRate && vatRate > 0) {
    const expected = round2(grossAmount - grossAmount / (1 + vatRate));
    return [...filtered].sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0];
  }

  return [...filtered].sort((a, b) => a - b)[0];
};

const inferCategory = (text: string): string => {
  const lower = text.toLowerCase();
  if (/(månadsavi|aviavgift|kontoavgift|uppläggningsavgift|bankavgift|bank fee)/i.test(lower)) return "bank_fee";
  if (lower.includes("accounting") || lower.includes("bokföring")) return "accounting";
  if (
    lower.includes("office") ||
    lower.includes("kontor") ||
    lower.includes("microphone") ||
    lower.includes("camera") ||
    lower.includes("printer") ||
    lower.includes("scandinavian photo")
  ) {
    return "office";
  }
  return "other";
};

const deriveFinancials = (params: {
  grossAmount?: number;
  netAmount?: number;
  vatAmount?: number;
  vatRate?: number;
}) => {
  let gross = params.grossAmount;
  let net = params.netAmount;
  let vat = params.vatAmount;
  let rate = params.vatRate;

  if (gross !== undefined && vat !== undefined && net === undefined) {
    net = round2(gross - vat);
  }
  if (net !== undefined && vat !== undefined && gross === undefined) {
    gross = round2(net + vat);
  }
  if (gross !== undefined && rate !== undefined && vat === undefined) {
    const computedNet = round2(gross / (1 + rate));
    vat = round2(gross - computedNet);
    net = computedNet;
  }
  if (gross !== undefined && vat !== undefined && (rate === undefined || rate === 0)) {
    const base = gross - vat;
    if (base > 0) {
      rate = round4(vat / base);
    }
  }

  return {
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    vatRate: rate
  };
};

const buildFromText = (text: string, fileName: string): ExtractedReceipt => {
  const rawText = text.replace(/\u00A0/g, " ");
  const tokens = extractAmountTokens(rawText);

  const grossByTotal = pickAmountNearKeyword(
    rawText,
    tokens,
    /(totalt?\s*belopp|total(?: amount)?|summa(?: att betala)?|belopp att betala|din faktura|amount due|att betala|lägsta belopp att betala)/i
  );
  const grossByCurrency = [...tokens]
    .filter((token) => tokenHasCurrencyNear(rawText, token))
    .sort((a, b) => b.value - a.value)[0]?.value;
  const grossAmount = grossByTotal ?? grossByCurrency ?? [...tokens].sort((a, b) => b.value - a.value)[0]?.value;

  let vatRate: number | undefined;
  const vatRateMatch = rawText.match(
    /(?:moms|vat)[^0-9%]{0,24}(\d{1,2}(?:[,.]\d{1,2})?)\s*%|(\d{1,2}(?:[,.]\d{1,2})?)\s*%\s*(?:på|on)/i
  );
  const vatRateRaw = vatRateMatch?.[1] ?? vatRateMatch?.[2];
  if (vatRateRaw) {
    const parsedRate = parseAmountString(vatRateRaw);
    if (parsedRate !== null) vatRate = round4(parsedRate / 100);
  }

  const vatAmount = extractVatAmount(rawText, grossAmount, vatRate);

  const derived = deriveFinancials({
    grossAmount,
    vatAmount,
    vatRate
  });

  const vendor = extractVendor(rawText, fileName);
  const issueDate = extractIssueDate(rawText);
  const receiptNumber = extractReceiptNumber(rawText);
  const currency = pickCurrency(rawText);
  const category = inferCategory(rawText);

  const score = [
    Boolean(vendor),
    Boolean(issueDate),
    Boolean(receiptNumber),
    Boolean(derived.grossAmount),
    Boolean(derived.vatAmount || derived.vatRate)
  ].filter(Boolean).length;
  const confidence = Math.min(0.95, round2(0.2 + score * 0.15));

  return {
    receiptNumber,
    vendor,
    issueDate,
    receiptDate: issueDate,
    grossAmount: derived.grossAmount,
    netAmount: derived.netAmount,
    vatAmount: derived.vatAmount,
    vatRate: derived.vatRate,
    currency,
    category,
    description: vendor ? `Receipt from ${vendor}` : `Imported from ${fileName}`,
    confidence,
    needsReview: !(vendor && issueDate && derived.grossAmount && (derived.vatAmount || derived.vatRate))
  };
};

const fallbackFromFilename = (fileName: string): ExtractedReceipt => {
  const amountMatch = fileName.match(/(\d+[.,]\d{2})/);
  const normalizedAmount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : undefined;
  const receiptNumberMatch = fileName.match(/(?:receipt|kvitto|nr|no)[-_ ]?([a-z0-9-]+)/i);
  const receiptNumber = receiptNumberMatch?.[1];

  return {
    receiptNumber,
    vendor: undefined,
    issueDate: undefined,
    receiptDate: undefined,
    grossAmount: normalizedAmount,
    currency: "SEK",
    vatRate: 0.25,
    category: "office",
    description: `Imported from ${fileName}`,
    confidence: normalizedAmount ? 0.55 : 0.3,
    needsReview: true
  };
};

const mergeExtracted = (primary: ExtractedReceipt, secondary: ExtractedReceipt): ExtractedReceipt => {
  const merged = {
    receiptNumber: primary.receiptNumber || secondary.receiptNumber,
    vendor: primary.vendor || secondary.vendor,
    issueDate: primary.issueDate || secondary.issueDate,
    receiptDate: primary.receiptDate || secondary.receiptDate || primary.issueDate || secondary.issueDate,
    grossAmount: primary.grossAmount ?? secondary.grossAmount,
    netAmount: primary.netAmount ?? secondary.netAmount,
    vatAmount: primary.vatAmount ?? secondary.vatAmount,
    currency: primary.currency || secondary.currency || "SEK",
    vatRate: primary.vatRate ?? secondary.vatRate,
    category: primary.category || secondary.category || "other",
    description: primary.description || secondary.description || `Imported from receipt`,
    confidence: Math.max(primary.confidence ?? 0, secondary.confidence ?? 0),
    needsReview: (primary.needsReview ?? true) || (secondary.needsReview ?? true)
  };

  return extractedReceiptSchema.parse(merged);
};

const runCmd = async (commands: Array<{ cmd: string; args: string[] }>) => {
  let lastError: unknown;
  for (const candidate of commands) {
    try {
      const result = await execFile(candidate.cmd, candidate.args, {
        maxBuffer: 12 * 1024 * 1024
      });
      return result.stdout;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No command succeeded.");
};

const extractPdfText = async (pdfPath: string) => {
  const stdout = await runCmd([
    { cmd: "pdftotext", args: [pdfPath, "-"] },
    { cmd: "/opt/homebrew/bin/pdftotext", args: [pdfPath, "-"] }
  ]);
  return normalizeSpace(stdout);
};

const ocrImage = async (imageInput: Buffer | string) => {
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(imageInput as any);
    return normalizeSpace(String(result.data.text || ""));
  } finally {
    await worker.terminate();
  }
};

const extractPdfTextWithImageFallback = async (params: {
  fileName: string;
  buffer: Buffer;
}) => {
  const tempDir = await mkdtemp(join(tmpdir(), "receipt-ocr-"));
  const pdfPath = join(tempDir, `${basename(params.fileName, extname(params.fileName) || ".pdf")}.pdf`);
  const imageBasePath = join(tempDir, "page1");
  try {
    await writeFile(pdfPath, params.buffer);
    const directText = await extractPdfText(pdfPath);
    if (directText.length >= 30) return directText;

    await runCmd([
      { cmd: "pdftoppm", args: ["-f", "1", "-singlefile", "-png", pdfPath, imageBasePath] },
      { cmd: "/opt/homebrew/bin/pdftoppm", args: ["-f", "1", "-singlefile", "-png", pdfPath, imageBasePath] }
    ]);
    const pngPath = `${imageBasePath}.png`;
    const ocrText = await ocrImage(pngPath);
    return ocrText;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const callVisionExtractor = async (params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ExtractedReceipt | null> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !params.mimeType.startsWith("image/")) return null;

  const prompt = `
Extract accounting fields from this receipt image for a Swedish sole trader.
Return strict JSON with:
{
  "receiptNumber": string | null,
  "vendor": string | null,
  "issueDate": "YYYY-MM-DD" | null,
  "grossAmount": number | null,
  "netAmount": number | null,
  "vatAmount": number | null,
  "currency": string,
  "vatRate": number | null,
  "category": string | null,
  "description": string | null,
  "confidence": number,
  "needsReview": boolean
}
Rules:
- confidence must be between 0 and 1.
- Extract receipt/invoice number when present (receipt no, kvittonummer, fakturanummer, OCR reference).
- Extract vendor, issue date, gross amount, VAT amount and VAT rate when present.
- currency must be a 3-letter ISO code when present (for example SEK, EUR, USD, GBP).
- vatRate must be decimal fraction (0.25, 0.12, 0.06, 0.00).
- needsReview=true if any core field is uncertain.
`.trim();

  const imageData = `data:${params.mimeType};base64,${params.buffer.toString("base64")}`;
  const model = process.env.OPENAI_RECEIPT_MODEL ?? "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageData }
          ]
        }
      ]
    })
  });

  if (!response.ok) return null;

  const json = await response.json();
  const outputText = getOutputText(json);
  if (!outputText) return null;

  const parsed = extractedReceiptSchema.parse(extractJson(outputText));
  const issueDate = parsed.issueDate ?? parsed.receiptDate;
  return {
    ...parsed,
    issueDate,
    receiptDate: issueDate
  };
};

const extractLocalText = async (params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) => {
  try {
    if (params.mimeType === "application/pdf" || params.fileName.toLowerCase().endsWith(".pdf")) {
      return await extractPdfTextWithImageFallback(params);
    }
    if (params.mimeType.startsWith("image/")) {
      return await ocrImage(params.buffer);
    }
  } catch {
    return "";
  }
  return "";
};

export const extractReceiptData = async (params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ExtractedReceipt> => {
  try {
    const text = await extractLocalText(params);
    const local = text ? buildFromText(text, params.fileName) : fallbackFromFilename(params.fileName);

    const vision = await callVisionExtractor(params);
    const merged = vision ? mergeExtracted(vision, local) : local;
    const issueDate = merged.issueDate ?? merged.receiptDate;

    const final = {
      ...merged,
      issueDate,
      receiptDate: issueDate
    };
    return extractedReceiptSchema.parse(final);
  } catch {
    return fallbackFromFilename(params.fileName);
  }
};
