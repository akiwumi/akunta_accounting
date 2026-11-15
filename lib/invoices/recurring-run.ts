/**
 * Creates the invoices that recurring templates are due for.
 *
 * Idempotent: the template's nextRunDate is moved forward in the same
 * database transaction that creates the invoice, and only if it still has the
 * value this run saw. Running the job twice, or two runs at once, creates one
 * invoice. A template that has fallen behind catches up one period per run.
 */

import { type PrismaClient } from "@prisma/client";

import { createInvoiceRecord } from "@/lib/invoices/create";
import { sendInvoiceEmail } from "@/lib/invoices/delivery";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import {
  advanceRunDate,
  isRecurringFrequency,
  parseRecurringItems,
  resolveAnchorDay
} from "@/lib/invoices/recurring";

export type RecurringRunResult = {
  templateId: string;
  businessId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  emailed: boolean;
  skipped?: string;
  error?: string;
};

/** Creates the invoice for one template if it is due. Returns null when there was nothing to do. */
export const runRecurringTemplate = async (db: PrismaClient, templateId: string, today: Date) =>
  db.$transaction(async (tx) => {
    const template = await tx.recurringInvoice.findUnique({ where: { id: templateId } });
    if (!template || !template.active || template.nextRunDate > today) return null;

    if (template.endDate && template.nextRunDate > template.endDate) {
      await tx.recurringInvoice.update({ where: { id: template.id }, data: { active: false } });
      return null;
    }

    const items = parseRecurringItems(template.itemsJson);
    if (items.length === 0) throw new Error("The recurring invoice has no valid lines.");

    const frequency = isRecurringFrequency(template.frequency) ? template.frequency : "MONTHLY";
    const history = await tx.invoice.findMany({
      where: { recurringInvoiceId: template.id },
      select: { issueDate: true }
    });
    const anchorDay = resolveAnchorDay(
      template.nextRunDate,
      history.map((row) => row.issueDate.getUTCDate())
    );
    const nextRunDate = advanceRunDate(template.nextRunDate, frequency, anchorDay);
    const continues = !template.endDate || nextRunDate <= template.endDate;

    const claimed = await tx.recurringInvoice.updateMany({
      where: { id: template.id, active: true, nextRunDate: template.nextRunDate },
      data: { nextRunDate, lastRunAt: new Date(), active: continues }
    });
    if (claimed.count !== 1) return null;

    const invoice = await createInvoiceRecord(tx, {
      businessId: template.businessId,
      customerId: template.customerId,
      customer: {
        name: template.customerName,
        email: template.customerEmail,
        address: template.customerAddress
      },
      items,
      // Issued the day it is created: an invoice is never backdated.
      issueDate: today,
      paymentTermsDays: template.paymentTermsDays,
      currency: template.currency,
      description: template.description,
      notes: template.notes,
      emailTo: template.customerEmail,
      recurringInvoiceId: template.id
    });

    return { invoice, autoSend: template.autoSend, to: template.customerEmail };
  });

export const runRecurringInvoices = async (
  db: PrismaClient,
  input: { today: Date; businessId?: string; limit?: number; send?: boolean }
): Promise<RecurringRunResult[]> => {
  const due = await db.recurringInvoice.findMany({
    where: {
      active: true,
      nextRunDate: { lte: input.today },
      ...(input.businessId ? { businessId: input.businessId } : {})
    },
    orderBy: { nextRunDate: "asc" },
    take: input.limit ?? 200,
    select: { id: true, businessId: true }
  });

  const results: RecurringRunResult[] = [];
  for (const template of due) {
    const result: RecurringRunResult = {
      templateId: template.id,
      businessId: template.businessId,
      invoiceId: null,
      invoiceNumber: null,
      emailed: false
    };
    try {
      const created = await runRecurringTemplate(db, template.id, input.today);
      if (!created) {
        result.skipped = "not_due";
      } else {
        result.invoiceId = created.invoice.id;
        result.invoiceNumber = created.invoice.invoiceNumber;
        if (created.autoSend && created.to && input.send !== false) {
          const loaded = await loadInvoiceForOutput({ businessId: template.businessId, invoiceId: created.invoice.id });
          const sent = loaded ? await sendInvoiceEmail(loaded, { to: created.to }) : null;
          result.emailed = Boolean(sent?.ok);
          if (sent && !sent.ok) result.error = `Created but not emailed: ${sent.message}`;
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Unknown error";
    }
    results.push(result);
  }
  return results;
};
