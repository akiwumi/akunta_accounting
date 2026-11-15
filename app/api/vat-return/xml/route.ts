import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import {
  buildEskdXml,
  buildMomsdeklaration,
  encodeEskdXml,
  ESKD_ENCODING,
  resolveOrgNr
} from "@/lib/tax/momsdeklaration";
import { findVatPeriod, vatPeriodOptionsFor } from "@/lib/tax/vat-periods";

export const dynamic = "force-dynamic";

/**
 * GET /api/vat-return/xml?period=<key>
 *
 * The momsdeklaration as the file Skatteverket's e-service takes under
 * "Deklarera via fil" (eSKDUpload 6.0, ISO-8859-1).
 */
export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        vatFrequency: true,
        fiscalYearStart: true,
        orgType: true,
        personnummer: true,
        vatNumber: true,
        invoiceSenderOrgNumber: true
      }
    });
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

    const period = findVatPeriod(new URL(request.url).searchParams.get("period"), vatPeriodOptionsFor(business));
    if (!period) return NextResponse.json({ error: "Unknown reporting period." }, { status: 404 });

    const orgNr = resolveOrgNr(business);
    if (!orgNr) {
      return NextResponse.json(
        { error: "Add your personnummer or organisation number under Settings before creating the file." },
        { status: 422 }
      );
    }

    const declaration = await buildMomsdeklaration({ businessId, from: period.start, to: period.end });
    const xml = buildEskdXml({ orgNr, skvPeriod: period.skvPeriod, boxes: declaration.boxes });

    return new NextResponse(new Uint8Array(encodeEskdXml(xml)), {
      status: 200,
      headers: {
        "Content-Type": `application/xml; charset=${ESKD_ENCODING}`,
        "Content-Disposition": `attachment; filename="momsdeklaration-${period.skvPeriod}.xml"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
