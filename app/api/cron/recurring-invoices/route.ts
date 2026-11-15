/**
 * POST /api/cron/recurring-invoices   (GET does the same: Vercel Cron calls with GET)
 *
 * Requires "Authorization: Bearer <CRON_SECRET>" and refuses to run when
 * CRON_SECRET is not set. Creates the invoices that recurring templates are
 * due for, numbered through the normal series, and emails them when the
 * template says so. Safe to call more than once a day: see
 * lib/invoices/recurring-run.ts.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { cronAuthFailure } from "@/lib/invoices/cron-auth";
import { stockholmToday } from "@/lib/invoices/dates";
import { runRecurringInvoices } from "@/lib/invoices/recurring-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handle = async (request: Request) => {
  const failure = cronAuthFailure(request);
  if (failure) return failure;

  const results = await runRecurringInvoices(prisma, { today: stockholmToday() });
  return NextResponse.json({
    created: results.filter((result) => result.invoiceId).length,
    emailed: results.filter((result) => result.emailed).length,
    failed: results.filter((result) => result.error).length,
    results
  });
};

export const POST = handle;
export const GET = handle;
