import { NextResponse } from "next/server";
import { z } from "zod";

import { journalErrorResponse, unauthorized } from "@/app/api/journal/errors";
import { postJournalEntries } from "@/lib/accounting/journal";
import { JOURNAL_TEMPLATE_IDS, saveTemplate } from "@/lib/accounting/journalTemplates";
import { requireAuthContext } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const amount = z.number().finite().min(0).max(1_000_000_000);

const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template"),
    template: z.enum(JOURNAL_TEMPLATE_IDS),
    /** Validated per template in lib/accounting/journalTemplates.ts. */
    input: z.record(z.string(), z.unknown())
  }),
  z.object({
    mode: z.literal("free"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().trim().min(1).max(200),
    reference: z.string().trim().max(120).optional(),
    lines: z.array(z.object({ accountId: z.string().min(1), debit: amount, credit: amount })).min(1).max(100),
    /** The user ticked "book it anyway" on the warning about VAT accounts. */
    acknowledgeVatWarning: z.boolean().default(false)
  })
]);

const summary = (transaction: { id: string; verificationNumber: number; txnDate: Date; description: string }) => ({
  id: transaction.id,
  verificationNumber: transaction.verificationNumber,
  txnDate: transaction.txnDate.toISOString().slice(0, 10),
  description: transaction.description
});

/**
 * POST /api/journal
 *
 * Books a manual journal entry: a guided template or a free entry. Both go
 * through createJournalEntry, which validates and writes the audit row.
 */
export async function POST(request: Request) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return unauthorized();
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INPUT" }, { status: 422 });
  }

  try {
    if (parsed.data.mode === "template") {
      const { transactions, plan } = await saveTemplate({
        businessId,
        userId,
        template: parsed.data.template,
        input: parsed.data.input
      });
      return NextResponse.json({ entries: transactions.map(summary), notices: plan.notices }, { status: 201 });
    }

    const transactions = await postJournalEntries([
      {
        businessId,
        userId,
        txnDate: new Date(`${parsed.data.date}T00:00:00.000Z`),
        description: parsed.data.description,
        reference: parsed.data.reference,
        lines: parsed.data.lines,
        acknowledgeVatWarning: parsed.data.acknowledgeVatWarning
      }
    ]);
    return NextResponse.json({ entries: transactions.map(summary), notices: [] }, { status: 201 });
  } catch (error) {
    return journalErrorResponse(error);
  }
}
