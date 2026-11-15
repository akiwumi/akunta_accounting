/**
 * Automatic payment reminders, for businesses that have switched them on.
 * One reminder per overdue invoice per run; the rules for when one is due
 * are in lib/invoices/reminders.ts.
 */

import { type PrismaClient } from "@prisma/client";

import { sendInvoiceReminder } from "@/lib/invoices/delivery";
import { addDays } from "@/lib/invoices/dates";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { MAX_AUTOMATIC_REMINDERS, reminderDecision } from "@/lib/invoices/reminders";

export type ReminderRunResult = {
  invoiceId: string;
  businessId: string;
  invoiceNumber: string;
  sent: boolean;
  /** Why no reminder was due. */
  reason?: string;
  /** Set when a reminder was due but could not be sent. */
  error?: string;
};

export const runInvoiceReminders = async (
  db: PrismaClient,
  input: { today: Date; limit?: number }
): Promise<ReminderRunResult[]> => {
  const businesses = await db.business.findMany({
    where: { invoiceReminderEnabled: true },
    select: { id: true, invoiceReminderDaysAfterDue: true }
  });

  const results: ReminderRunResult[] = [];
  let budget = input.limit ?? 200;

  for (const business of businesses) {
    if (budget <= 0) break;
    const daysAfterDue = Math.max(1, business.invoiceReminderDaysAfterDue);
    const candidates = await db.invoice.findMany({
      where: {
        businessId: business.id,
        status: { in: ["UNPAID", "PARTIAL"] },
        sentAt: { not: null },
        dueDate: { lte: addDays(input.today, -daysAfterDue) },
        reminderCount: { lt: MAX_AUTOMATIC_REMINDERS }
      },
      orderBy: { dueDate: "asc" },
      take: budget,
      select: { id: true }
    });

    for (const candidate of candidates) {
      const invoice = await loadInvoiceForOutput({ businessId: business.id, invoiceId: candidate.id });
      if (!invoice) continue;
      const to = invoice.emailTo?.trim() || invoice.customerEmail?.trim() || null;
      const decision = reminderDecision({
        status: invoice.status,
        remaining: invoice.remainingAmount,
        dueDate: invoice.dueDate,
        sentAt: invoice.sentAt,
        recipientEmail: to,
        reminderCount: invoice.reminderCount,
        lastReminderAt: invoice.lastReminderAt,
        today: input.today,
        daysAfterDue
      });
      const result: ReminderRunResult = {
        invoiceId: invoice.id,
        businessId: business.id,
        invoiceNumber: invoice.invoiceNumber,
        sent: false
      };
      if (!decision.due || !to) {
        result.reason = decision.due ? "no_email" : decision.reason;
      } else {
        const sent = await sendInvoiceReminder(invoice, { to });
        result.sent = sent.ok;
        if (!sent.ok) result.error = sent.message;
        budget -= 1;
      }
      results.push(result);
      if (budget <= 0) break;
    }
  }

  return results;
};
