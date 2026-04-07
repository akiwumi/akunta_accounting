/**
 * Dispatches to cash or accrual posting based on the business bookkeeping method.
 * All new code should call `createTransaction()` from here rather than importing
 * posting.ts or posting-accrual.ts directly.
 */

import { prisma } from "@/lib/db";
import { assertNotLockedPeriod } from "@/lib/accounting/period-locks";
import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { createAccrualTransaction } from "@/lib/accounting/posting-accrual";
import { type EntrySource, type TransactionDirection } from "@/lib/domain/enums";
import { type SupportedCurrency } from "@/lib/fx/sek";

type CreateTransactionInput = {
  businessId: string;
  txnDate: Date;
  description: string;
  direction: TransactionDirection;
  grossAmount: number;
  vatRate?: number;
  netAmount?: number;
  vatAmount?: number;
  source: EntrySource;
  receiptId?: string;
  reference?: string;
  currency?: string;
  sourceCurrency?: SupportedCurrency;
  fxRateToSek?: number;
  fxRateDate?: Date;
  incomeAccountCode?: string;
  expenseAccountCode?: string;
  bankAccountCode?: string;
  paidInvoiceId?: string;
};

export const createTransaction = async (input: CreateTransactionInput) => {
  await assertNotLockedPeriod(input.businessId, input.txnDate);

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { bookkeepingMethod: true }
  });

  if (business?.bookkeepingMethod === "fakturametoden") {
    return createAccrualTransaction(input);
  }

  return createCashMethodTransaction(input);
};
