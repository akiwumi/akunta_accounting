/**
 * Reconciliation matching engine.
 *
 * Matches BankStatementLines against unreconciled Transactions using:
 *  1. Exact amount + date match (high confidence)
 *  2. Exact amount, date within ±3 days (medium confidence)
 *  3. Amount within 0.5%, same week (low confidence)
 *
 * Returns ranked suggestions per bank line. The user confirms or rejects each.
 */

import { round2 } from "@/lib/accounting/math";

export type BankLine = {
  id: string;
  txnDate: Date;
  description: string;
  amount: number; // positive = credit to account, negative = debit
  currency: string;
};

export type LedgerTransaction = {
  id: string;
  txnDate: Date;
  description: string;
  grossAmount: number;
  direction: string; // "INCOME" | "EXPENSE"
  source: string;
};

export type MatchSuggestion = {
  bankLineId: string;
  transactionId: string;
  confidence: "high" | "medium" | "low";
  score: number;
  reason: string;
};

const daysDiff = (a: Date, b: Date) =>
  Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

const signedAmount = (txn: LedgerTransaction): number =>
  txn.direction === "INCOME" ? txn.grossAmount : -txn.grossAmount;

const amountClose = (a: number, b: number, tolerancePct = 0.005): boolean => {
  if (a === 0 && b === 0) return true;
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  return Math.abs(a - b) / avg <= tolerancePct;
};

export const generateSuggestions = (
  bankLines: BankLine[],
  transactions: LedgerTransaction[],
  alreadyMatchedTxnIds: Set<string>
): MatchSuggestion[] => {
  const suggestions: MatchSuggestion[] = [];

  for (const line of bankLines) {
    const lineAmount = round2(line.amount);

    for (const txn of transactions) {
      if (alreadyMatchedTxnIds.has(txn.id)) continue;

      const txnAmount = round2(signedAmount(txn));
      const days = daysDiff(line.txnDate, txn.txnDate);

      // Exact amount + same day
      if (txnAmount === lineAmount && days === 0) {
        suggestions.push({
          bankLineId: line.id,
          transactionId: txn.id,
          confidence: "high",
          score: 100,
          reason: "Exact amount and date match"
        });
        continue;
      }

      // Exact amount, close date (±3 days)
      if (txnAmount === lineAmount && days <= 3) {
        suggestions.push({
          bankLineId: line.id,
          transactionId: txn.id,
          confidence: "medium",
          score: 80 - days * 5,
          reason: `Exact amount, date offset ${days} day(s)`
        });
        continue;
      }

      // Close amount (±0.5%), within a week
      if (amountClose(txnAmount, lineAmount) && days <= 7) {
        suggestions.push({
          bankLineId: line.id,
          transactionId: txn.id,
          confidence: "low",
          score: 50 - days * 3,
          reason: `Near-matching amount (within 0.5%), date offset ${days} day(s)`
        });
      }
    }
  }

  // Sort by bankLineId then descending score
  suggestions.sort((a, b) => {
    if (a.bankLineId !== b.bankLineId) return a.bankLineId.localeCompare(b.bankLineId);
    return b.score - a.score;
  });

  return suggestions;
};

/**
 * Return the top suggestion per bank line (best score).
 */
export const topSuggestionPerLine = (suggestions: MatchSuggestion[]): MatchSuggestion[] => {
  const seen = new Map<string, MatchSuggestion>();
  for (const s of suggestions) {
    const existing = seen.get(s.bankLineId);
    if (!existing || s.score > existing.score) {
      seen.set(s.bankLineId, s);
    }
  }
  return Array.from(seen.values());
};
