/**
 * GET /api/compliance/status
 *
 * Aggregated live compliance status for the authenticated business.
 * Combines data from the local DB (filings, tax events, period locks,
 * unmatched bank lines) and optionally the Skatteverket Skattekonto API.
 *
 * Response shape:
 * {
 *   vatFilings:         Filing[]         — recent VAT filings sorted by periodEnd desc
 *   taxEvents:          TaxEvent[]       — upcoming/recent events (Kundhändelser)
 *   periodLocks:        PeriodLock[]     — all locked periods
 *   unmatchedBankLines: number           — count of UNMATCHED BankStatementLines
 *   openInvoices:       number           — count of UNPAID invoices
 *   receiptsNeedReview: number           — count of receipts still flagged needsReview
 *   skattekonto: {
 *     available:    boolean              — false when SKV not configured
 *     saldoSEK?:   number               — positive = credit, negative = debt
 *     error?:      string               — if the live fetch failed
 *   }
 * }
 */

import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getSkattekontoBalanceSEK } from "@/lib/integrations/skatteverket/skattekonto";

export const dynamic = "force-dynamic";

export async function GET() {
  const { businessId } = await requireAuthContext();
  const business = await requireBusiness(businessId);

  // ── Parallel DB queries ──────────────────────────────────────────────────
  const [
    vatFilings,
    taxEvents,
    periodLocks,
    unmatchedBankLines,
    openInvoices,
    receiptsNeedReview,
  ] = await Promise.all([
    prisma.filing.findMany({
      where: { businessId, filingType: "MOMS" },
      orderBy: { periodEnd: "desc" },
      take: 12,
    }),
    prisma.taxEvent.findMany({
      where: { businessId },
      orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }],
      take: 20,
    }),
    prisma.periodLock.findMany({
      where: { businessId },
      orderBy: { periodStart: "desc" },
    }),
    prisma.bankStatementLine.count({
      where: { businessId, status: "UNMATCHED" },
    }),
    prisma.invoice.count({
      where: { businessId, status: "UNPAID" },
    }),
    prisma.receipt.count({
      where: { businessId, needsReview: true },
    }),
  ]);

  // ── Live Skattekonto (optional — requires skvActorId) ────────────────────
  let skattekonto: { available: boolean; saldoSEK?: number; error?: string } = {
    available: false,
  };

  const orgNumber =
    business.personnummer ?? business.vatNumber ?? business.skvActorId;

  if (orgNumber) {
    try {
      const saldoSEK = await getSkattekontoBalanceSEK(orgNumber);
      skattekonto = { available: true, saldoSEK };
    } catch (err) {
      skattekonto = {
        available: true,
        error: err instanceof Error ? err.message : "Skattekonto unavailable",
      };
    }
  }

  return NextResponse.json({
    vatFilings,
    taxEvents,
    periodLocks,
    unmatchedBankLines,
    openInvoices,
    receiptsNeedReview,
    skattekonto,
  });
}
