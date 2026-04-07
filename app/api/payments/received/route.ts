import { NextResponse } from "next/server";
import { z } from "zod";

import { createCashMethodTransaction } from "@/lib/accounting/posting";
import { asNumber } from "@/lib/accounting/math";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { EntrySources, TransactionDirections } from "@/lib/domain/enums";

const paymentReceivedSchema = z.object({
  payer: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200).optional(),
  paymentDate: z.string().min(10),
  grossAmount: z.number().positive(),
  vatRate: z.number().min(0).max(1).default(0.25),
  currency: z.enum(["SEK", "EUR", "GBP"]).default("SEK"),
  reference: z.string().trim().max(120).optional(),
  incomeAccountCode: z.string().trim().min(4).max(10).default("3001")
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = paymentReceivedSchema.parse(await request.json());
  const { businessId } = await requireAuthContext();

  const paymentDate = new Date(`${payload.paymentDate}T00:00:00.000Z`);
  if (Number.isNaN(paymentDate.valueOf())) {
    return NextResponse.json({ error: "Invalid payment date." }, { status: 400 });
  }

  const normalizedReference = payload.reference?.trim() || undefined;

  const linkedInvoice = normalizedReference
    ? await prisma.invoice.findFirst({
        where: {
          businessId,
          invoiceNumber: normalizedReference,
          status: "UNPAID"
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
          currency: true
        }
      })
    : null;

  const currency = linkedInvoice ? linkedInvoice.currency : payload.currency;
  const source = linkedInvoice ? EntrySources.INVOICE_PAYMENT : EntrySources.MANUAL;
  const description =
    payload.description?.trim() ||
    linkedInvoice?.description?.trim() ||
    linkedInvoice?.projectName?.trim() ||
    `Payment received from ${payload.payer}`;
  const reference = linkedInvoice?.invoiceNumber || normalizedReference || payload.payer;
  const linkedVatRate = linkedInvoice ? asNumber(linkedInvoice.vatRate) : payload.vatRate;
  const linkedGrossAmount = linkedInvoice ? asNumber(linkedInvoice.grossAmount) : payload.grossAmount;
  const linkedNetAmount =
    linkedInvoice && asNumber(linkedInvoice.subtotalAmount) > 0
      ? asNumber(linkedInvoice.subtotalAmount)
      : linkedInvoice
        ? linkedVatRate > 0
          ? linkedGrossAmount / (1 + linkedVatRate)
          : linkedGrossAmount
        : undefined;
  const linkedVatAmount =
    linkedInvoice && asNumber(linkedInvoice.vatAmount) > 0
      ? asNumber(linkedInvoice.vatAmount)
      : linkedInvoice
        ? linkedGrossAmount - (linkedNetAmount ?? linkedGrossAmount)
        : undefined;

  const transaction = await createCashMethodTransaction({
    businessId,
    txnDate: paymentDate,
    description,
    direction: TransactionDirections.INCOME,
    grossAmount: linkedGrossAmount,
    netAmount: linkedNetAmount,
    vatAmount: linkedVatAmount,
    vatRate: linkedVatRate,
    source,
    reference,
    currency,
    incomeAccountCode: payload.incomeAccountCode,
    paidInvoiceId: linkedInvoice?.id
  });

  if (linkedInvoice) {
    await prisma.invoice.update({
      where: { id: linkedInvoice.id },
      data: {
        status: "PAID",
        paidAt: paymentDate
      }
    });
  }

  return NextResponse.json({
    transaction: {
      id: transaction.id,
      description: transaction.description,
      grossAmount: asNumber(transaction.grossAmount),
      currency: transaction.currency
    }
  });
}
