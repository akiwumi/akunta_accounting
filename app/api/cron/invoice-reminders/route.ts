/**
 * POST /api/cron/invoice-reminders   (GET does the same: Vercel Cron calls with GET)
 *
 * Requires "Authorization: Bearer <CRON_SECRET>" and refuses to run when
 * CRON_SECRET is not set. Sends one polite reminder per overdue invoice for
 * businesses with automatic reminders on: first when the invoice is
 * invoiceReminderDaysAfterDue days past due, then at most once every 7 days,
 * 3 at most. No fees or interest are added.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { cronAuthFailure } from "@/lib/invoices/cron-auth";
import { stockholmToday } from "@/lib/invoices/dates";
import { runInvoiceReminders } from "@/lib/invoices/reminder-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handle = async (request: Request) => {
  const failure = cronAuthFailure(request);
  if (failure) return failure;

  const results = await runInvoiceReminders(prisma, { today: stockholmToday() });
  return NextResponse.json({
    sent: results.filter((result) => result.sent).length,
    checked: results.length,
    failed: results.filter((result) => result.error).length,
    results
  });
};

export const POST = handle;
export const GET = handle;
