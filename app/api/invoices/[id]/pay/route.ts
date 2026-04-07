import { NextResponse } from "next/server";
import { z } from "zod";

import { createTransaction } from "@/lib/accounting/posting-dispatcher";
import { asNumber, round2 } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

const payInvoiceSchema = z.object({
  paymentDate: z.string().min(10).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function POST(request: Request, context: { params: { id: string } }) {
  const invoiceId = context.params.id;
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice id." }, { status: 400 });

  try {
    const { businessId } = await requireAuthContext();
    const payload = payInvoiceSchema.parse(await request.json().catch(() => ({})));
    const paymentDateIso = payload.paymentDate ?? todayIso();
    const paymentDate = new Date(`${paymentDateIso}T00:00:00.000Z`);
    if (Number.isNaN(paymentDate.valueOf())) return NextResponse.json({ error: "Invalid payment date." }, { status: 400 });

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: {
        id: true, invoiceNumber: true, customerName: true,
        description: true, projectName: true,
        subtotalAmount: true, vatAmount: true, grossAmount: true, vatRate: true, currency: true, status: true
      }
    });

    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    if (invoice.status === "PAID") return NextResponse.json({ error: "Invoice already marked as paid." }, { status: 409 });
    if (invoice.status === "VOID") return NextResponse.json({ error: "Invoice is voided." }, { status: 409 });

    const grossAmount = asNumber(invoice.grossAmount);
    const vatRate = asNumber(invoice.vatRate);
    const rawNet = asNumber(invoice.subtotalAmount);
    const rawVat = asNumber(invoice.vatAmount);
    const netAmount = rawNet > 0 ? rawNet : vatRate > 0 ? round2(grossAmount / (1 + vatRate)) : grossAmount;
    const vatAmount = rawVat > 0 ? rawVat : round2(grossAmount - netAmount);

    const transaction = await createTransaction({
      businessId,
      txnDate: paymentDate,
      description:
        invoice.description?.trim() ||
        invoice.projectName?.trim() ||
        `Invoice ${invoice.invoiceNumber} payment from ${invoice.customerName}`,
      direction: TransactionDirections.INCOME,
      grossAmount,
      netAmount,
      vatAmount,
      vatRate,
      source: EntrySources.INVOICE_PAYMENT,
      reference: invoice.invoiceNumber,
      currency: invoice.currency,
      incomeAccountCode: "3001",
      paidInvoiceId: invoice.id
    });

    await prisma.$transaction([
      prisma.invoicePayment.create({
        data: {
          businessId,
          invoiceId: invoice.id,
          transactionId: transaction.id,
          paymentDate,
          amount: grossAmount,
          currency: invoice.currency
        }
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: paymentDate }
      })
    ]);

    return NextResponse.json({ invoiceId: invoice.id, transactionId: transaction.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
