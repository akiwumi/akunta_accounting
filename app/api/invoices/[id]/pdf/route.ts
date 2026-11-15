import { NextResponse } from "next/server";

import { authOrNull, jsonError, unauthorized } from "@/lib/invoices/http";
import { invoicePdfFileName, loadInvoiceForOutput, renderInvoicePdf } from "@/lib/invoices/load";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();

  const invoice = await loadInvoiceForOutput({ businessId: auth.businessId, invoiceId: (await context.params).id });
  if (!invoice) return jsonError("Invoice not found.", 404);

  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new NextResponse(new Uint8Array(renderInvoicePdf(invoice)), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoicePdfFileName(invoice)}"`,
      "Cache-Control": "no-store"
    }
  });
}
