/**
 * Core OCR extraction logic for the async receipt processing pipeline.
 *
 * Called by:
 *   - lib/queue/jobs.ts devFallback (no QStash token / local dev)
 *   - app/api/queue/ocr/route.ts (QStash webhook in production)
 */

import { asNumber, round2 } from "@/lib/accounting/math";
import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { convertToSekAtDate, normalizeCurrency } from "@/lib/fx/sek";
import { extractReceiptData } from "@/lib/receipts/extract";
import { accountCodeForCategory, normalizeReceiptCategory } from "@/lib/receipts/mapper";
import { inferReceiptMimeType } from "@/lib/receipts/mime";
import { readReceiptFile } from "@/lib/storage/receipts";
import type { OcrJobPayload } from "@/lib/queue/jobs";

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export async function runOcrJob(job: OcrJobPayload): Promise<void> {
  const { receiptId, businessId } = job;

  // ── Load receipt ────────────────────────────────────────────────────────────
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, businessId },
  });
  if (!receipt) throw new Error(`Receipt ${receiptId} not found`);

  // Already processed — skip (idempotent)
  if (!receipt.needsReview && receipt.grossAmount !== null) return;

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { taxConfig: true },
  });

  // ── Read file from storage ───────────────────────────────────────────────────
  // filePath holds the storage key (local) or the public URL (supabase).
  // readReceiptFile accepts the key; for supabase URLs we derive the key from the path.
  const storageKey = receipt.filePath.startsWith("http")
    ? new URL(receipt.filePath).pathname.split("/").pop()!
    : receipt.filePath;

  const buffer = await readReceiptFile(storageKey);
  const effectiveMimeType = inferReceiptMimeType(receipt.originalFileName, receipt.mimeType);

  // ── Extract ─────────────────────────────────────────────────────────────────
  const extracted = await extractReceiptData({
    fileName: receipt.originalFileName,
    mimeType: effectiveMimeType,
    buffer,
  });

  const receiptDate = extracted.issueDate ?? extracted.receiptDate;
  const vatRateDefault = business.taxConfig
    ? asNumber(business.taxConfig.vatStandardRate as unknown as number | string)
    : 0.25;

  let grossAmount =
    extracted.grossAmount !== undefined ? round2(asNumber(extracted.grossAmount)) : undefined;
  const vatAmountFromExtract =
    extracted.vatAmount !== undefined ? round2(asNumber(extracted.vatAmount)) : undefined;
  const netAmountFromExtract =
    extracted.netAmount !== undefined ? round2(asNumber(extracted.netAmount)) : undefined;

  let vatRate =
    extracted.vatRate !== undefined && extracted.vatRate !== null
      ? asNumber(extracted.vatRate)
      : undefined;
  let vatAmount = vatAmountFromExtract;
  let netAmount = netAmountFromExtract;

  if (grossAmount !== undefined && vatAmount !== undefined && vatRate === undefined) {
    const base = grossAmount - vatAmount;
    if (base > 0) vatRate = round4(vatAmount / base);
  }

  const vatRateForPosting = vatRate ?? vatRateDefault;
  if (grossAmount !== undefined && vatAmount === undefined) {
    netAmount = round2(grossAmount / (1 + vatRateForPosting));
    vatAmount = round2(grossAmount - netAmount);
  } else if (grossAmount !== undefined && vatAmount !== undefined && netAmount === undefined) {
    netAmount = round2(grossAmount - vatAmount);
  }

  // ── FX conversion ───────────────────────────────────────────────────────────
  const sourceCurrency = normalizeCurrency(extracted.currency ?? "SEK");
  const receiptSourceCurrency = sourceCurrency === "SEK" ? null : sourceCurrency;
  let postingGrossAmount = grossAmount;
  let postingNetAmount = netAmount;
  let postingVatAmount = vatAmount;
  let postingCurrency = "SEK";
  let postingSourceCurrency: string | null = null;
  let fxRateToSek: number | null = null;
  let fxRateDate: Date | null = null;

  if (grossAmount !== undefined) {
    const converted = await convertToSekAtDate({
      currency: sourceCurrency,
      date: receiptDate ? new Date(`${receiptDate}T00:00:00.000Z`) : new Date(),
      grossAmount,
      netAmount,
      vatAmount,
    });
    postingGrossAmount = converted.grossAmountSek;
    postingNetAmount = converted.netAmountSek;
    postingVatAmount = converted.vatAmountSek;
    postingCurrency = converted.currency;
    postingSourceCurrency = converted.sourceCurrency;
    fxRateToSek = converted.fxRateToSek;
    fxRateDate = converted.fxDate;
  }

  const normalizedCategory = normalizeReceiptCategory(extracted.category);
  const category = normalizedCategory === "sales" ? "other" : normalizedCategory;
  const rawItemPurchased = extracted.description?.trim();
  const itemPurchased =
    rawItemPurchased &&
    !/^receipt from\s+/i.test(rawItemPurchased) &&
    !/^imported from\s+/i.test(rawItemPurchased)
      ? rawItemPurchased
      : null;

  // ── Persist extraction results ───────────────────────────────────────────────
  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      receiptNumber: extracted.receiptNumber ?? receipt.receiptNumber,
      vendor: extracted.vendor ?? receipt.vendor,
      ...(itemPurchased ? { itemPurchased } : {}),
      receiptDate: receiptDate ? new Date(`${receiptDate}T00:00:00.000Z`) : receipt.receiptDate,
      grossAmount,
      netAmount,
      vatAmount,
      vatRate: vatRateForPosting,
      currency: sourceCurrency,
      sourceCurrency: receiptSourceCurrency ?? undefined,
      fxRateToSek: fxRateToSek ?? undefined,
      fxRateDate: fxRateDate ?? undefined,
      category,
      confidence: extracted.confidence,
      needsReview: extracted.needsReview,
    },
  });

  // ── Post transaction ────────────────────────────────────────────────────────
  if (postingGrossAmount !== undefined && postingGrossAmount > 0) {
    // Only create a transaction if one doesn't exist for this receipt yet
    const existing = await prisma.transaction.findFirst({
      where: { receiptId },
    });
    if (!existing) {
      await createTransaction({
        businessId,
        txnDate: receiptDate ? new Date(`${receiptDate}T00:00:00.000Z`) : new Date(),
        description:
          itemPurchased ??
          extracted.description ??
          extracted.vendor ??
          extracted.receiptNumber ??
          receipt.originalFileName,
        direction: TransactionDirections.EXPENSE,
        grossAmount: postingGrossAmount,
        vatRate: vatRateForPosting,
        netAmount: postingNetAmount,
        vatAmount: postingVatAmount,
        source: EntrySources.RECEIPT,
        receiptId,
        currency: postingCurrency,
        sourceCurrency: postingSourceCurrency ?? undefined,
        fxRateToSek: fxRateToSek ?? undefined,
        fxRateDate: fxRateDate ?? undefined,
        incomeAccountCode: "3001",
        expenseAccountCode: accountCodeForCategory(category, TransactionDirections.EXPENSE),
        reference: extracted.receiptNumber,
      });
    }
  }
}
