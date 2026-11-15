import { NextResponse } from "next/server";

import { requireAuthContext, writeAuditLog } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { buildSieExport, SieExportError } from "@/lib/sie/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/exports/sie?year=2025 downloads the fiscal year as a SIE 4 file. */
export async function GET(request: Request) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sv = (await getRequestLocale()) === "sv";
  const yearParam = new URL(request.url).searchParams.get("year") ?? "";
  const year = Number(yearParam);
  if (!/^\d{4}$/.test(yearParam)) {
    return NextResponse.json(
      {
        error: sv
          ? "Välj vilket räkenskapsår du vill exportera, till exempel 2025."
          : "Choose which fiscal year to export, for example 2025."
      },
      { status: 400 }
    );
  }

  try {
    const { bytes, fileName, document } = await buildSieExport(prisma, { businessId, year });
    await writeAuditLog(businessId, userId, "SieExport", String(year), "EXPORT", undefined, {
      fileName,
      vouchers: document.vouchers.length
    });
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        // The file is codepage 437 ("PC8"), so it must not be served as text
        // in a declared charset: the browser would re-encode it.
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof SieExportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: sv
          ? "SIE-filen kunde inte skapas. Försök igen om en stund."
          : "The SIE file could not be created. Try again in a moment."
      },
      { status: 500 }
    );
  }
}
