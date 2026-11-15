/**
 * GET /api/invoices/[id]/rot-rut/request-file
 *
 * The request for payout ("begäran om utbetalning") for one ROT/RUT invoice,
 * as the XML file Skatteverket's e-service Rot och rut - företag imports.
 * Only once the customer has paid their part. The file holds the buyer's
 * personnummer, so it is never cached.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, requestText, rotRutErrorResponse, unauthorized } from "@/lib/invoices/http";
import { buildRotRutRequestFile } from "@/lib/invoices/rotrut-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  try {
    const file = await buildRotRutRequestFile(prisma, {
      businessId: auth.businessId,
      today: stockholmToday(),
      invoiceId: (await props.params).id
    });
    return new NextResponse(file.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const mapped = rotRutErrorResponse(error, t);
    if (mapped) return mapped;
    throw error;
  }
}
