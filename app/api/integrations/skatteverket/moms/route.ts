import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { buildVatReturnPayload, submitMomsdeklaration, getMomsdeklarationStatus } from "@/lib/integrations/skatteverket/momsdeklaration";
import { prisma } from "@/lib/db";

const submitSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outputVatSEK: z.number(),
  inputVatSEK: z.number(),
  salesHighVatSEK: z.number().default(0),
  salesMidVatSEK: z.number().default(0),
  salesLowVatSEK: z.number().default(0)
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();
    const business = await requireBusiness(businessId);

    const orgNumber = business.personnummer ?? business.vatNumber ?? business.skvActorId;
    if (!orgNumber) return NextResponse.json({ error: "No organisation number configured." }, { status: 422 });

    const body = await request.json();
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { periodStart, periodEnd, ...amounts } = parsed.data;

    const payload = buildVatReturnPayload(orgNumber, { from: periodStart, to: periodEnd }, amounts);
    const submission = await submitMomsdeklaration(payload);

    await prisma.filing.create({
      data: {
        businessId,
        filingType: "MOMSDEKLARATION",
        periodStart: new Date(`${periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${periodEnd}T23:59:59.999Z`),
        status: "SUBMITTED",
        externalRef: submission.referenceId,
        payloadJson: JSON.stringify(payload),
        responseJson: JSON.stringify(submission),
        submittedAt: new Date()
      }
    });

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { businessId } = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const referenceId = searchParams.get("referenceId");

    if (referenceId) {
      const status = await getMomsdeklarationStatus(referenceId);
      return NextResponse.json(status);
    }

    const filings = await prisma.filing.findMany({
      where: { businessId, filingType: "MOMSDEKLARATION" },
      orderBy: { submittedAt: "desc" }
    });
    return NextResponse.json(filings);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
