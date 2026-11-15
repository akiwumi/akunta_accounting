import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { authOrNull, jsonError, unauthorized } from "@/lib/invoices/http";
import { loadQuoteForOutput, quotePdfFileName, renderQuotePdf } from "@/lib/invoices/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();

  const quote = await loadQuoteForOutput(prisma, { businessId: auth.businessId, quoteId: (await context.params).id });
  if (!quote) return jsonError("Quote not found.", 404);

  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new NextResponse(new Uint8Array(renderQuotePdf(quote)), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${quotePdfFileName(quote)}"`,
      "Cache-Control": "no-store"
    }
  });
}
