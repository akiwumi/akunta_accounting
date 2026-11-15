import { readFile } from "node:fs/promises";

import { ACTIVE_TRANSACTION, voidTransaction } from "@/lib/accounting/ledger";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { asNumber, round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { convertToSekAtDate, normalizeCurrency } from "@/lib/fx/sek";
import { extractReceiptData } from "@/lib/receipts/extract";
import { accountCodeForCategory, normalizeReceiptCategory } from "@/lib/receipts/mapper";

const round4 = (value: number) => Math.round(value * 10000) / 10000;

const run = async () => {
  const receipts = await prisma.receipt.findMany({
    where: { deletedAt: null },
    include: {
      business: {
        include: {
          taxConfig: true
        }
      },
      transactions: {
        // Entries still in force only; cancelled entries and corrections are history.
        where: ACTIVE_TRANSACTION,
        select: {
          id: true,
          txnDate: true,
          description: true,
          reference: true,
          grossAmount: true,
          netAmount: true,
          vatAmount: true,
          vatRate: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  let updatedReceipts = 0;
  let createdTransactions = 0;
  let rebuiltTransactions = 0;
  const notes: string[] = [];

  for (const receipt of receipts) {
    try {
      const buffer = await readFile(receipt.filePath);
      const extracted = await extractReceiptData({
        fileName: receipt.originalFileName,
        mimeType: receipt.mimeType,
        buffer
      });

      const vatRateDefault = receipt.business.taxConfig
        ? asNumber(receipt.business.taxConfig.vatStandardRate as unknown as number | string)
        : 0.25;
      const grossAmount = extracted.grossAmount !== undefined ? round2(asNumber(extracted.grossAmount)) : null;
      let vatAmount = extracted.vatAmount !== undefined ? round2(asNumber(extracted.vatAmount)) : null;
      let netAmount = extracted.netAmount !== undefined ? round2(asNumber(extracted.netAmount)) : null;
      let vatRate = extracted.vatRate !== undefined && extracted.vatRate !== null ? asNumber(extracted.vatRate) : null;

      if (grossAmount !== null && vatAmount !== null && vatRate === null) {
        const base = grossAmount - vatAmount;
        if (base > 0) {
          vatRate = round4(vatAmount / base);
        }
      }

      if (grossAmount !== null && vatAmount === null) {
        const effectiveVatRate = vatRate ?? vatRateDefault;
        netAmount = round2(grossAmount / (1 + effectiveVatRate));
        vatAmount = round2(grossAmount - netAmount);
        vatRate = effectiveVatRate;
      } else if (grossAmount !== null && vatAmount !== null && netAmount === null) {
        netAmount = round2(grossAmount - vatAmount);
      }

      const issueDate = extracted.issueDate ?? extracted.receiptDate;
      const normalizedCategory = normalizeReceiptCategory(extracted.category ?? receipt.category);
      const category = normalizedCategory === "sales" ? "other" : normalizedCategory;
      const sourceCurrency = normalizeCurrency(extracted.currency || receipt.currency || receipt.sourceCurrency || "SEK");
      const currency = sourceCurrency;
      const sourceCurrencyStored: string | null = sourceCurrency === "SEK" ? null : sourceCurrency;
      let fxRateToSek = receipt.fxRateToSek !== null ? asNumber(receipt.fxRateToSek) : null;
      let fxRateDate = receipt.fxRateDate ?? null;
      let postingGrossAmount = grossAmount;
      let postingNetAmount = netAmount;
      let postingVatAmount = vatAmount;
      let postingSourceCurrency: string | null = null;

      if (grossAmount !== null) {
        const converted = await convertToSekAtDate({
          currency: sourceCurrency,
          date: issueDate ? `${issueDate}T00:00:00.000Z` : receipt.receiptDate ?? receipt.createdAt,
          grossAmount,
          netAmount: netAmount ?? undefined,
          vatAmount: vatAmount ?? undefined
        });
        postingGrossAmount = converted.grossAmountSek;
        postingNetAmount = converted.netAmountSek ?? netAmount;
        postingVatAmount = converted.vatAmountSek ?? vatAmount;
        postingSourceCurrency = converted.sourceCurrency;
        fxRateToSek = converted.fxRateToSek;
        fxRateDate = converted.fxDate;
      }

      const shouldRefreshExisting = receipt.needsReview || extracted.confidence > asNumber(receipt.confidence ?? 0);
      const receiptGross = receipt.grossAmount !== null ? asNumber(receipt.grossAmount) : null;
      const receiptNet = receipt.netAmount !== null ? asNumber(receipt.netAmount) : null;
      const receiptVat = receipt.vatAmount !== null ? asNumber(receipt.vatAmount) : null;
      const receiptVatRate = receipt.vatRate !== null ? asNumber(receipt.vatRate) : null;
      const receiptGrossNeedsRounding = receiptGross !== null && Math.abs(round2(receiptGross) - receiptGross) > 0.000001;
      const receiptNetNeedsRounding = receiptNet !== null && Math.abs(round2(receiptNet) - receiptNet) > 0.000001;
      const receiptVatNeedsRounding = receiptVat !== null && Math.abs(round2(receiptVat) - receiptVat) > 0.000001;
      const receiptSourceCurrency = receipt.sourceCurrency ? normalizeCurrency(receipt.sourceCurrency) : null;
      const receiptFxRateToSek = receipt.fxRateToSek !== null ? asNumber(receipt.fxRateToSek) : null;
      const receiptFxDateIso = receipt.fxRateDate ? receipt.fxRateDate.toISOString().slice(0, 10) : null;
      const fxDateIso = fxRateDate ? fxRateDate.toISOString().slice(0, 10) : null;

      const updateData: Record<string, unknown> = {};
      if (extracted.receiptNumber && (!receipt.receiptNumber || shouldRefreshExisting)) {
        updateData.receiptNumber = extracted.receiptNumber;
      }
      if (extracted.vendor && (!receipt.vendor || shouldRefreshExisting)) {
        updateData.vendor = extracted.vendor;
      }
      if (issueDate && (!receipt.receiptDate || shouldRefreshExisting)) {
        updateData.receiptDate = new Date(`${issueDate}T00:00:00.000Z`);
      }
      if (
        grossAmount !== null &&
        (receiptGross === null || shouldRefreshExisting || receiptGrossNeedsRounding || Math.abs(receiptGross - grossAmount) > 0.01)
      ) {
        updateData.grossAmount = grossAmount;
      }
      if (
        netAmount !== null &&
        (receiptNet === null || shouldRefreshExisting || receiptNetNeedsRounding || Math.abs(receiptNet - netAmount) > 0.01)
      ) {
        updateData.netAmount = netAmount;
      }
      if (
        vatAmount !== null &&
        (receiptVat === null || shouldRefreshExisting || receiptVatNeedsRounding || Math.abs(receiptVat - vatAmount) > 0.01)
      ) {
        updateData.vatAmount = vatAmount;
      }
      if (vatRate !== null && (receiptVatRate === null || shouldRefreshExisting || Math.abs(receiptVatRate - vatRate) > 0.0001)) {
        updateData.vatRate = round4(vatRate);
      }
      if (receipt.currency !== currency) updateData.currency = currency;
      if (receiptSourceCurrency !== sourceCurrencyStored) updateData.sourceCurrency = sourceCurrencyStored;
      if (
        (receiptFxRateToSek === null && fxRateToSek !== null) ||
        (receiptFxRateToSek !== null && fxRateToSek === null) ||
        (receiptFxRateToSek !== null && fxRateToSek !== null && Math.abs(receiptFxRateToSek - fxRateToSek) > 0.000001)
      ) {
        updateData.fxRateToSek = fxRateToSek;
      }
      if (receiptFxDateIso !== fxDateIso) updateData.fxRateDate = fxRateDate;
      if (receipt.category !== category) updateData.category = category;
      if (extracted.confidence > asNumber(receipt.confidence ?? 0)) updateData.confidence = extracted.confidence;
      if (extracted.needsReview === false) updateData.needsReview = false;

      if (Object.keys(updateData).length > 0) {
        await prisma.receipt.update({
          where: { id: receipt.id },
          data: updateData
        });
        updatedReceipts += 1;
      }

      const hasPostableAmounts = postingGrossAmount !== null && postingGrossAmount > 0;
      const desiredReference = extracted.receiptNumber || receipt.receiptNumber || null;
      const desiredDescription = extracted.description || extracted.vendor || extracted.receiptNumber || receipt.originalFileName;
      const desiredTxnDateIso = issueDate ? `${issueDate}T00:00:00.000Z` : null;
      const shouldRebuildTransactions =
        hasPostableAmounts &&
        receipt.transactions.some((transaction) => {
          const txGross = asNumber(transaction.grossAmount);
          const txNet = asNumber(transaction.netAmount);
          const txVat = asNumber(transaction.vatAmount);
          const txVatRate = asNumber(transaction.vatRate);
          const txDateIso = transaction.txnDate.toISOString();
          return (
            (postingGrossAmount !== null && Math.abs(txGross - postingGrossAmount) > 0.01) ||
            (postingNetAmount !== null && Math.abs(txNet - postingNetAmount) > 0.01) ||
            (postingVatAmount !== null && Math.abs(txVat - postingVatAmount) > 0.01) ||
            (vatRate !== null && Math.abs(txVatRate - vatRate) > 0.0001) ||
            (desiredTxnDateIso !== null && txDateIso !== desiredTxnDateIso)
          );
        });

      if (shouldRebuildTransactions) {
        // A booked entry is never deleted: each one is cancelled by a correcting entry.
        await prisma.$transaction(async (tx) => {
          for (const transaction of receipt.transactions) {
            await voidTransaction(tx, {
              businessId: receipt.businessId,
              transactionId: transaction.id,
              reason: "Receipt re-extracted"
            });
          }
        });
        rebuiltTransactions += receipt.transactions.length;
      } else {
        // Text is not part of the booked amounts and may be corrected in place.
        for (const transaction of receipt.transactions) {
          if (
            transaction.description !== desiredDescription ||
            (desiredReference !== null && transaction.reference !== desiredReference)
          ) {
            await prisma.transaction.update({
              where: { id: transaction.id },
              data: { description: desiredDescription, ...(desiredReference !== null ? { reference: desiredReference } : {}) }
            });
          }
        }
      }

      // An unreviewed receipt is booked on approval, not here.
      const reviewed = !receipt.needsReview || extracted.needsReview === false;
      if (shouldRebuildTransactions || (receipt.transactions.length === 0 && reviewed && hasPostableAmounts)) {
        if (postingGrossAmount === null) continue;
        const firstTxnDate = receipt.transactions[0]?.txnDate;
        const postDate = issueDate
          ? new Date(`${issueDate}T00:00:00.000Z`)
          : firstTxnDate ?? receipt.createdAt;
        const effectiveVatRate = vatRate ?? vatRateDefault;
        const description = desiredDescription;

        await createCashMethodTransaction({
          businessId: receipt.businessId,
          txnDate: postDate,
          description,
          direction: TransactionDirections.EXPENSE,
          grossAmount: postingGrossAmount,
          vatRate: effectiveVatRate,
          netAmount: postingNetAmount ?? undefined,
          vatAmount: postingVatAmount ?? undefined,
          source: EntrySources.RECEIPT,
          receiptId: receipt.id,
          currency: "SEK",
          sourceCurrency: postingSourceCurrency ?? undefined,
          fxRateToSek: fxRateToSek ?? undefined,
          fxRateDate: fxRateDate ?? undefined,
          incomeAccountCode: "3001",
          expenseAccountCode: accountCodeForCategory(category, TransactionDirections.EXPENSE),
          reference: desiredReference ?? undefined
        });

        createdTransactions += 1;
      }
    } catch (error) {
      notes.push(`ERROR ${receipt.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned: receipts.length,
        updatedReceipts,
        createdTransactions,
        rebuiltTransactions,
        notes
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
