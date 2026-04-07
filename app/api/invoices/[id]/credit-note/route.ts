import { NextResponse } from "next/server";
import { z } from "zod";

import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { asNumber, round2 } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

const creditNoteSchema = z.object({
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  reason: z.string().max(500).optional()
});

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json().catch(() => ({}));
    const parsed = creditNoteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { issueDate, amount, reason } = parsed.data;
    const txnDate = new Date(`${issueDate}T00:00:00.000Z`);

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, businessId }
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    // Generate credit note number
    const count = await prisma.creditNote.count({ where: { businessId } });
    const year = txnDate.getFullYear();
    const seq = String(count + 1).padStart(4, "0");
    const creditNoteNumber = `CN-${year}-${seq}`;

    const vatRate = asNumber(invoice.vatRate);
    const netAmount = vatRate > 0 ? round2(amount / (1 + vatRate)) : amount;
    const vatAmount = round2(amount - netAmount);

    // Reverse the original income posting
    const transaction = await createTransaction({
      businessId,
      txnDate,
      description: `Credit note ${creditNoteNumber} — Invoice ${invoice.invoiceNumber}`,
      direction: TransactionDirections.EXPENSE,
      grossAmount: round2(amount),
      netAmount,
      vatAmount,
      vatRate,
      source: EntrySources.INVOICE_PAYMENT,
      reference: creditNoteNumber,
      expenseAccountCode: "3001"  // reverse income account
    });

    const creditNote = await prisma.creditNote.create({
      data: {
        businessId,
        invoiceId: invoice.id,
        creditNoteNumber,
        issueDate: txnDate,
        amount: round2(amount),
        vatAmount,
        netAmount,
        reason,
        status: "ISSUED",
        transactionId: transaction.id
      }
    });

    return NextResponse.json({ creditNote, transaction }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();
    const creditNotes = await prisma.creditNote.findMany({
      where: { invoiceId: params.id, businessId },
      orderBy: { issueDate: "desc" }
    });
    return NextResponse.json(creditNotes);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
