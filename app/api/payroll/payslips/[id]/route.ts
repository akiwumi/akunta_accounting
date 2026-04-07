import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { buildPayslipData } from "@/lib/payroll/payslips";
import { readInvoicePdf } from "@/lib/storage/invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/payroll/payslips/[id] — return payslip data (JSON) or PDF file
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();
    const { searchParams } = new URL(request.url);

    const payslip = await prisma.payslip.findFirst({
      where: { salaryEntryId: params.id, businessId }
    });

    if (!payslip) {
      // Fall back to building live data if payslip record not yet generated
      const data = await buildPayslipData(params.id, businessId);
      return NextResponse.json(data);
    }

    if (searchParams.get("format") === "pdf" && payslip.pdfKey) {
      const buffer = await readInvoicePdf(payslip.pdfKey);
      return new Response(buffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="payslip-${params.id}.txt"`
        }
      });
    }

    return NextResponse.json(payslip);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
