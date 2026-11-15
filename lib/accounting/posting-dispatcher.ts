/**
 * Dispatches to cash or accrual posting based on the business bookkeeping method.
 * All new code should call `createTransaction()` from here rather than importing
 * posting.ts or posting-accrual.ts directly.
 */

import { prisma } from "@/lib/db";
import { assertNotLockedPeriod } from "@/lib/accounting/period-locks";
import { createCashMethodTransaction, createSalesRefundTransaction } from "@/lib/accounting/posting";
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

/**
 * Refund to a customer. Under kontantmetoden it is booked as negative sales.
 * Under fakturametoden the previous posting is kept until the accrual invoice
 * flow is rebuilt (invoices are not yet booked at issue there).
 */
export const createSalesRefund = async (input: {
  businessId: string;
  txnDate: Date;
  description: string;
  grossAmount: number;
  vatRate: number;
  source: EntrySource;
  reference?: string;
  currency?: string;
}) => {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { bookkeepingMethod: true }
  });

  if (business?.bookkeepingMethod === "fakturametoden") {
    const netAmount = input.vatRate > 0 ? Math.round((input.grossAmount / (1 + input.vatRate)) * 100) / 100 : input.grossAmount;
    return createTransaction({
      ...input,
      direction: "EXPENSE",
      netAmount,
      vatAmount: Math.round((input.grossAmount - netAmount) * 100) / 100,
      expenseAccountCode: "3001"
    });
  }

  return createSalesRefundTransaction(input);
};
