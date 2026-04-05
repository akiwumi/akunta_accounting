import { NextResponse } from "next/server";

import {
  createCashMethodTransaction,
  normalizeGrossAmount,
  parseDirectionFromAmount
} from "@/lib/accounting/posting";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { EntrySources } from "@/lib/domain/enums";
import { parseBankCsv } from "@/lib/imports/bankCsv";
import { accountCodeForCategory, normalizeReceiptCategory } from "@/lib/receipts/mapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const business = await ensureBusiness();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing CSV file." }, { status: 400 });
  }

  const csvText = await file.text();
  const parsedRows = parseBankCsv(csvText);

  const batch = await prisma.bankImportBatch.create({
    data: {
      businessId: business.id,
      fileName: file.name,
      importedRows: parsedRows.length,
      acceptedRows: 0,
      rejectedRows: 0
    }
  });

  let acceptedRows = 0;
  let rejectedRows = 0;
  const rowSummaries: Array<{
    rowNumber: number;
    status: string;
    description: string;
    amount: number;
    transactionId?: string;
    rejectionReason?: string;
  }> = [];

  for (const row of parsedRows) {
    try {
      const direction = parseDirectionFromAmount(row.amount);
      const category = normalizeReceiptCategory(row.category);
      const transaction = await createCashMethodTransaction({
        businessId: business.id,
        txnDate: row.txnDate,
        description: row.description,
        direction,
        grossAmount: normalizeGrossAmount(row.amount),
        vatRate: row.vatRate,
        source: EntrySources.BANK_IMPORT,
        reference: `CSV:${file.name}:row:${row.rowNumber}`,
        currency: row.currency,
        incomeAccountCode: "3001",
        expenseAccountCode: accountCodeForCategory(category, direction)
      });

      acceptedRows += 1;
      rowSummaries.push({
        rowNumber: row.rowNumber,
        status: "accepted",
        description: row.description,
        amount: row.amount,
        transactionId: transaction.id
      });
    } catch (error) {
      rejectedRows += 1;
      rowSummaries.push({
        rowNumber: row.rowNumber,
        status: "rejected",
        description: row.description,
        amount: row.amount,
        rejectionReason: error instanceof Error ? error.message : "Unknown import error"
      });
    }
  }

  await prisma.$transaction([
    prisma.bankImportRow.createMany({
      data: rowSummaries.map((row) => ({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        txnDate: parsedRows.find((parsed) => parsed.rowNumber === row.rowNumber)?.txnDate ?? new Date(),
        description: row.description,
        amount: row.amount,
        status: row.status,
        rejectionReason: row.rejectionReason,
        transactionId: row.transactionId
      }))
    }),
    prisma.bankImportBatch.update({
      where: { id: batch.id },
      data: {
        acceptedRows,
        rejectedRows
      }
    })
  ]);

  return NextResponse.json({
    batchId: batch.id,
    importedRows: parsedRows.length,
    acceptedRows,
    rejectedRows,
    rows: rowSummaries
  });
}
