/**
 * POST /api/invoices/[id]/rot-rut/requested
 *
 * "I have sent the request": stamps rotRutRequestedAt. { sent: false } takes
 * the stamp back, as long as Skatteverket's payout is not registered.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { authOrNull, jsonError, requestText, rotRutErrorResponse, unauthorized, zodMessage } from "@/lib/invoices/http";
import { markRotRutRequested } from "@/lib/invoices/rotrut-actions";

const schema = z.object({ sent: z.boolean().default(true) });

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

  try {
    const updated = await markRotRutRequested(prisma, {
      businessId: auth.businessId,
      invoiceIds: [(await props.params).id],
      sent: parsed.data.sent
    });
    return NextResponse.json({ updated: updated.length, sent: parsed.data.sent });
  } catch (error) {
    const mapped = rotRutErrorResponse(error, t);
    if (mapped) return mapped;
    throw error;
  }
}
