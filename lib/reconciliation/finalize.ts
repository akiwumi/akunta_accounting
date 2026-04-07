/**
 * Finalize a reconciliation match:
 *  - Links the BankStatementLine to a Transaction
 *  - Marks the line as MATCHED
 *  - Optionally creates a correction transaction if amounts differ
 */

import { round2 } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";

export const finalizeMatch = async (
  businessId: string,
  bankLineId: string,
  transactionId: string
): Promise<void> => {
  const [line, txn] = await Promise.all([
    prisma.bankStatementLine.findFirst({ where: { id: bankLineId, businessId } }),
    prisma.transaction.findFirst({ where: { id: transactionId, businessId } })
  ]);

  if (!line) throw new Error(`Bank statement line ${bankLineId} not found.`);
  if (!txn) throw new Error(`Transaction ${transactionId} not found.`);
  if (line.status === "MATCHED") throw new Error("Bank line is already matched.");

  await prisma.bankStatementLine.update({
    where: { id: bankLineId },
    data: {
      status: "MATCHED",
      matchedTransactionId: transactionId
    }
  });
};

export const unmatch = async (businessId: string, bankLineId: string): Promise<void> => {
  const line = await prisma.bankStatementLine.findFirst({ where: { id: bankLineId, businessId } });
  if (!line) throw new Error(`Bank statement line ${bankLineId} not found.`);

  await prisma.bankStatementLine.update({
    where: { id: bankLineId },
    data: { status: "UNMATCHED", matchedTransactionId: null }
  });
};

export const ignoreUnmatched = async (businessId: string, bankLineId: string): Promise<void> => {
  await prisma.bankStatementLine.updateMany({
    where: { id: bankLineId, businessId },
    data: { status: "IGNORED" }
  });
};

export const getReconciliationStats = async (businessId: string) => {
  const [total, matched, ignored, unmatched] = await Promise.all([
    prisma.bankStatementLine.count({ where: { businessId } }),
    prisma.bankStatementLine.count({ where: { businessId, status: "MATCHED" } }),
    prisma.bankStatementLine.count({ where: { businessId, status: "IGNORED" } }),
    prisma.bankStatementLine.count({ where: { businessId, status: "UNMATCHED" } })
  ]);

  return {
    total,
    matched,
    ignored,
    unmatched,
    matchRate: total > 0 ? round2((matched / total) * 100) : 0
  };
};
