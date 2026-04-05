import { NextResponse } from "next/server";

import { ensureBusiness } from "@/lib/data/business";
import { loadInvoiceForOutput } from "@/lib/invoices/load";
import { buildInvoicePdf } from "@/lib/invoices/pdf";

type RouteContext = {
  params: {
    id: string;
  };
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sanitizeFileNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "invoice";

export async function GET(_request: Request, context: RouteContext) {
  const invoiceId = context.params.id;
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice id." }, { status: 400 });
  }

  const business = await ensureBusiness();
  const invoice = await loadInvoiceForOutput({
    businessId: business.id,
    invoiceId
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const buffer = buildInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    projectName: invoice.projectName,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    sender: {
      name: invoice.senderName,
      address: invoice.senderAddress,
      registration: invoice.senderOrgNumber,
      email: invoice.senderEmail,
      phone: invoice.senderPhone,
      website: invoice.senderWebsite
    },
    customer: {
      name: invoice.customerName,
      address: invoice.customerAddress,
      email: invoice.customerEmail,
      phone: invoice.customerPhone,
      website: invoice.customerWebsite
    },
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatAmount: item.vatAmount,
      totalAmount: item.totalAmount
    })),
    subtotalAmount: invoice.subtotalAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
    notes: invoice.notes,
    paymentMethod: invoice.paymentMethod,
    paymentDetails: invoice.paymentDetails
  });

  const filename = `invoice-${sanitizeFileNamePart(invoice.invoiceNumber)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
