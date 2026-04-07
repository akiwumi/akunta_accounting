import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { asNumber } from "@/lib/accounting/math";
import { generateSuggestions, topSuggestionPerLine, type BankLine, type LedgerTransaction } from "@/lib/reconciliation/matcher";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { businessId } = await requireAuthContext();

    // Fetch unmatched bank lines
    const bankLines = await prisma.bankStatementLine.findMany({
      where: { businessId, status: "UNMATCHED" },
      orderBy: { txnDate: "desc" },
      take: 200
    });

    if (bankLines.length === 0) return NextResponse.json({ suggestions: [], bankLines: [] });

    // Fetch recent unlinked transactions (no paidInvoiceId, no receipt already matched)
    // Consider transactions within 30 days of the earliest bank line date
    const earliestDate = bankLines.reduce((min, l) => (l.txnDate < min ? l.txnDate : min), bankLines[0].txnDate);
    const windowStart = new Date(earliestDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const transactions = await prisma.transaction.findMany({
      where: {
        businessId,
        txnDate: { gte: windowStart },
        // Exclude transactions already reconciled via bank lines
        NOT: {
          id: {
            in: (await prisma.bankStatementLine.findMany({
              where: { businessId, status: "MATCHED", matchedTransactionId: { not: null } },
              select: { matchedTransactionId: true }
            })).map((l) => l.matchedTransactionId!)
          }
        }
      },
      select: { id: true, txnDate: true, description: true, grossAmount: true, direction: true, source: true }
    });

    const lines: BankLine[] = bankLines.map((l) => ({
      id: l.id,
      txnDate: l.txnDate,
      description: l.description,
      amount: asNumber(l.amount),
      currency: l.currency
    }));

    const txns: LedgerTransaction[] = transactions.map((t) => ({
      id: t.id,
      txnDate: t.txnDate,
      description: t.description,
      grossAmount: asNumber(t.grossAmount),
      direction: t.direction,
      source: t.source
    }));

    const alreadyMatched = new Set<string>();
    const all = generateSuggestions(lines, txns, alreadyMatched);
    const top = topSuggestionPerLine(all);

    return NextResponse.json({
      bankLines: bankLines.map((l) => ({
        ...l,
        amount: asNumber(l.amount),
        suggestion: top.find((s) => s.bankLineId === l.id) ?? null
      })),
      suggestions: top
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
