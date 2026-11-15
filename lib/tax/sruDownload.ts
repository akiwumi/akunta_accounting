/**
 * Shared handler behind the two SRU download routes
 * (/api/year-end/sru/info and /api/year-end/sru/blanketter).
 */

import { NextResponse } from "next/server";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { requireAuthContext } from "@/lib/auth/context";
import { parseTaxYear } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { buildYearEndOverview } from "@/lib/tax/neYearEnd";
import { buildNeSruFiles, isSruYearSupported, sruSupportedIncomeYears, type SruSubmitter } from "@/lib/tax/sru";

export const sruDownload = async (request: Request, file: "info" | "blanketter") => {
  const { businessId, userId } = await requireAuthContext();
  const year = parseTaxYear(new URL(request.url).searchParams.get("year"));
  if (year === null || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year query parameter is required (e.g. ?year=2026)." }, { status: 400 });
  }
  if (!isSruYearSupported(year)) {
    return NextResponse.json(
      {
        error: `No SRU file can be made for income year ${year}: Skatteverket's field codes for that year are not in Akunta. Supported years: ${sruSupportedIncomeYears().join(", ")}.`
      },
      { status: 422 }
    );
  }

  const overview = await buildYearEndOverview(businessId, year);
  if (!overview.sru.ready) {
    return NextResponse.json(
      { error: "Details are missing for the SRU files.", missing: overview.sru.missing },
      { status: 422 }
    );
  }

  const files = buildNeSruFiles({
    ne: overview.ne,
    submitter: overview.sru.defaults as SruSubmitter,
    general: overview.inputs.general
  });

  await writeLedgerAudit(prisma, {
    businessId,
    userId,
    entityType: "YearEnd",
    entityId: String(year),
    action: "EXPORT_SRU",
    after: { file, block: files.block, result: overview.ne.result }
  });

  const body = file === "info" ? files.info : files.blanketter;
  const filename = file === "info" ? "INFO.SRU" : "BLANKETTER.SRU";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/plain; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
};
