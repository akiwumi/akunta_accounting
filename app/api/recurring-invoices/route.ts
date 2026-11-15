import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";
import { stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, unauthorized } from "@/lib/invoices/http";
import { parseRecurringItems, recurringState } from "@/lib/invoices/recurring";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authOrNull();
  if (!auth) return unauthorized();

  const today = stockholmToday();
  const templates = await prisma.recurringInvoice.findMany({
    where: { businessId: auth.businessId },
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }],
    include: { _count: { select: { invoices: true } } }
  });

  return NextResponse.json({
    recurringInvoices: templates.map((template) => ({
      id: template.id,
      customerId: template.customerId,
      customerName: template.customerName,
      description: template.description,
      frequency: template.frequency,
      nextRunDate: template.nextRunDate,
      endDate: template.endDate,
      autoSend: template.autoSend,
      state: recurringState(template, today),
      currency: template.currency,
      grossAmount: computeInvoiceTotals(parseRecurringItems(template.itemsJson)).grossAmount,
      invoiceCount: template._count.invoices
    }))
  });
}
