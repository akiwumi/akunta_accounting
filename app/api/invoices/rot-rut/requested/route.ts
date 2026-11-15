/**
 * POST /api/invoices/rot-rut/requested
 *
 * "I have sent the request" for several invoices at once, after they went to
 * Skatteverket in one file. All or nothing: if one of them is not ready,
 * none is stamped.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { authOrNull, jsonError, requestText, rotRutErrorResponse, unauthorized, zodMessage } from "@/lib/invoices/http";
import { markRotRutRequested } from "@/lib/invoices/rotrut-actions";

const schema = z.object({ invoiceIds: z.array(z.string().min(1).max(64)).min(1).max(1000) });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  try {
    const updated = await markRotRutRequested(prisma, {
      businessId: auth.businessId,
      invoiceIds: parsed.data.invoiceIds,
      sent: true
    });
    return NextResponse.json({ updated: updated.length });
  } catch (error) {
    const mapped = rotRutErrorResponse(error, t);
    if (mapped) return mapped;
    throw error;
  }
}
