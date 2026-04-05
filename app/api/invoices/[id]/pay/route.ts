import { NextResponse } from "next/server";
import { z } from "zod";

import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

type RouteContext = {
  params: {
    id: string;
  };
};

const payInvoiceSchema = z.object({
  paymentDate: z.string().min(10).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function POST(request: Request, context: RouteContext) {
  const invoiceId = context.params.id;
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice id." }, { status: 400 });
  }

  const business = await ensureBusiness();
  const payload = payInvoiceSchema.parse(await request.json().catch(() => ({})));
  const paymentDateIso = payload.paymentDate ?? todayIso();
  const paymentDate = new Date(`${paymentDateIso}T00:00:00.000Z`);
  if (Number.isNaN(paymentDate.valueOf())) {
    return NextResponse.json({ error: "Invalid payment date." }, { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId: business.id
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerName: true,
      description: true,
      projectName: true,
      subtotalAmount: true,
      vatAmount: true,
      grossAmount: true,
      vatRate: true,
      currency: true,
      status: true
    }
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status === "PAID") {
    return NextResponse.json({ error: "Invoice already marked as paid." }, { status: 409 });
  }

  const grossAmount = asNumber(invoice.grossAmount);
  const vatRate = asNumber(invoice.vatRate);
  const rawNetAmount = asNumber(invoice.subtotalAmount);
  const rawVatAmount = asNumber(invoice.vatAmount);
  const netAmount = rawNetAmount > 0 ? rawNetAmount : vatRate > 0 ? grossAmount / (1 + vatRate) : grossAmount;
  const vatAmount = rawVatAmount > 0 ? rawVatAmount : grossAmount - netAmount;

  const transaction = await createCashMethodTransaction({
    businessId: business.id,
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

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "PAID",
      paidAt: paymentDate
    }
  });

  return NextResponse.json({
    invoiceId: invoice.id,
    transactionId: transaction.id
  });
}
