import { asNumber } from "@/lib/accounting/math";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";
import { normalizeCurrency } from "@/lib/fx/sek";
import { accountCodeForCategory, normalizeReceiptCategory } from "@/lib/receipts/mapper";

const DEFAULT_VAT_RATE = 0.25;

const toUtcDateOnly = (value: Date) => {
  const y = value.getUTCFullYear();
  const m = value.getUTCMonth();
  const d = value.getUTCDate();
  return new Date(Date.UTC(y, m, d));
};

async function main() {
  const receipts = await prisma.receipt.findMany({
    where: {
      transactions: {
        none: {}
      }
    },
    include: {
      business: {
        include: { taxConfig: true }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  let created = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const receipt of receipts) {
    const gross = receipt.grossAmount ? asNumber(receipt.grossAmount) : 0;
    if (!Number.isFinite(gross) || gross <= 0) {
      skipped += 1;
      details.push(`SKIP ${receipt.id}: missing/invalid gross amount`);
      continue;
    }
    const net = receipt.netAmount !== null ? asNumber(receipt.netAmount) : undefined;
    const vat = receipt.vatAmount !== null ? asNumber(receipt.vatAmount) : undefined;

    const vatRate =
      receipt.vatRate !== null
        ? asNumber(receipt.vatRate)
        : receipt.business.taxConfig
          ? asNumber(receipt.business.taxConfig.vatStandardRate)
          : DEFAULT_VAT_RATE;

    const normalizedCategory = normalizeReceiptCategory(receipt.category);
    const category = normalizedCategory === "sales" ? "other" : normalizedCategory;
    const txnDate = toUtcDateOnly(receipt.receiptDate ?? receipt.createdAt);
    const description =
      receipt.vendor?.trim() ||
      receipt.receiptNumber?.trim() ||
      `Receipt ${receipt.originalFileName}`;

    await createCashMethodTransaction({
      businessId: receipt.businessId,
      txnDate,
      description,
      direction: TransactionDirections.EXPENSE,
      grossAmount: gross,
      vatRate,
      netAmount: net,
      vatAmount: vat,
      source: EntrySources.RECEIPT,
      receiptId: receipt.id,
      currency: normalizeCurrency(receipt.currency || receipt.business.baseCurrency || "SEK"),
      sourceCurrency: receipt.sourceCurrency ? normalizeCurrency(receipt.sourceCurrency) : undefined,
      fxRateToSek: receipt.fxRateToSek !== null ? asNumber(receipt.fxRateToSek) : undefined,
      fxRateDate: receipt.fxRateDate ?? undefined,
      incomeAccountCode: "3001",
      expenseAccountCode: accountCodeForCategory(category, TransactionDirections.EXPENSE),
      reference: receipt.receiptNumber ?? undefined
    });

    created += 1;
    details.push(`CREATE ${receipt.id}: ${gross.toFixed(2)} ${(receipt.currency || "SEK").toUpperCase()}`);
  }

  console.log(
    JSON.stringify(
      {
        scanned: receipts.length,
        created,
        skipped,
        details
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
