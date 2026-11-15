/**
 * GET /api/invoices/rot-rut/request-file?type=ROT&year=2026&part=1
 *
 * One request file for every invoice of that type whose customer paid in
 * that year and that has not been requested yet. Skatteverket takes one type
 * and one payment year per file and at most 100 buyers, so a longer list
 * comes in parts. Nothing personal is in the address; the file itself holds
 * the buyers' personnummer and is never cached.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { stockholmToday } from "@/lib/invoices/dates";
import { authOrNull, jsonError, requestText, rotRutErrorResponse, unauthorized } from "@/lib/invoices/http";
import { isRotRutType } from "@/lib/invoices/rotrut";
import { buildRotRutRequestFile } from "@/lib/invoices/rotrut-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const t = await requestText();

  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const year = Number(params.get("year"));
  const part = Number(params.get("part") ?? "1");
  if (!isRotRutType(type) || !Number.isInteger(year) || year < 2009 || year > 2100 || !Number.isInteger(part) || part < 1) {
    return jsonError(t("Ange typ (ROT eller RUT) och betalningsår.", "Give the type (ROT or RUT) and the payment year."), 400);
  }

  try {
    const file = await buildRotRutRequestFile(prisma, {
      businessId: auth.businessId,
      today: stockholmToday(),
      type,
      year,
      part
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
