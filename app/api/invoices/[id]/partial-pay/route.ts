import { NextResponse } from "next/server";
import { z } from "zod";

import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { asNumber, round2 } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

const partialPaySchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional()
});

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json().catch(() => ({}));
    const parsed = partialPaySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { paymentDate, amount, reference, notes } = parsed.data;
    const txnDate = new Date(`${paymentDate}T00:00:00.000Z`);

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, businessId },
      include: { payments: true }
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    if (invoice.status === "VOID") return NextResponse.json({ error: "Invoice is voided." }, { status: 409 });

    const grossTotal = asNumber(invoice.grossAmount);
    const alreadyPaid = round2(invoice.payments.reduce((s, p) => s + asNumber(p.amount), 0));
    const remaining = round2(grossTotal - alreadyPaid);

    if (round2(amount) > round2(remaining + 0.01)) {
      return NextResponse.json({ error: `Payment amount ${amount} exceeds remaining balance ${remaining}.` }, { status: 422 });
    }

    const vatRate = asNumber(invoice.vatRate);
    const paymentNet = vatRate > 0 ? round2(amount / (1 + vatRate)) : amount;
    const paymentVat = round2(amount - paymentNet);

    const transaction = await createTransaction({
      businessId,
      txnDate,
      description: `Partial payment — Invoice ${invoice.invoiceNumber}`,
      direction: TransactionDirections.INCOME,
      grossAmount: round2(amount),
      netAmount: paymentNet,
      vatAmount: paymentVat,
      vatRate,
      source: EntrySources.INVOICE_PAYMENT,
      reference: reference ?? invoice.invoiceNumber,
      incomeAccountCode: "3001"
    });

    const payment = await prisma.invoicePayment.create({
      data: {
        businessId,
        invoiceId: invoice.id,
        transactionId: transaction.id,
        paymentDate: txnDate,
        amount: round2(amount),
        currency: invoice.currency,
        reference,
        notes
      }
    });

    const newAlreadyPaid = round2(alreadyPaid + round2(amount));
    const isFullyPaid = newAlreadyPaid >= round2(grossTotal - 0.01);

    if (isFullyPaid) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: txnDate }
      });
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PARTIAL" }
      });
    }

    return NextResponse.json({ payment, transaction, fullyPaid: isFullyPaid }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
