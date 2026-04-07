import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { saveDeclarationDraft, buildDeclaration } from "@/lib/payroll/declarations";

const draftSchema = z.object({
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12)
});

export const dynamic = "force-dynamic";

// GET — list all employer declarations
export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const declarations = await prisma.employerDeclaration.findMany({
      where: { businessId },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }]
    });
    return NextResponse.json(declarations);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

// POST — create or refresh a draft declaration for a period
export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json();
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { year, month } = parsed.data;

    // Preview the aggregated data
    const payload = await buildDeclaration(businessId, year, month);
    const declarationId = await saveDeclarationDraft(businessId, year, month);

    return NextResponse.json({ declarationId, payload }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
