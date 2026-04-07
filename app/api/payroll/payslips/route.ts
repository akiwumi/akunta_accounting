import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { buildPayslipData, generateAndStorePayslip } from "@/lib/payroll/payslips";
import { readInvoicePdf } from "@/lib/storage/invoices";

const generateSchema = z.object({ salaryEntryId: z.string().cuid() });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — list all payslips for this business
export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const payslips = await prisma.payslip.findMany({
      where: { businessId },
      orderBy: { paymentDate: "desc" }
    });
    return NextResponse.json(payslips);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

// POST — generate a payslip for a salary entry
export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json();
    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const result = await generateAndStorePayslip(parsed.data.salaryEntryId, businessId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
