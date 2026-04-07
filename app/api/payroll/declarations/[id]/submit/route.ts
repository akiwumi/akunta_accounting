import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { submitArbetsgivardeklaration } from "@/lib/integrations/skatteverket/arbetsgivardeklaration";
import type { DeclarationPayload } from "@/lib/payroll/declarations";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();

    const declaration = await prisma.employerDeclaration.findFirst({
      where: { id: params.id, businessId }
    });
    if (!declaration) return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
    if (declaration.status === "SUBMITTED") return NextResponse.json({ error: "Already submitted." }, { status: 409 });
    if (!declaration.payloadJson) return NextResponse.json({ error: "Declaration has no payload. Build the draft first." }, { status: 422 });

    const payload = JSON.parse(declaration.payloadJson) as DeclarationPayload;
    const result = await submitArbetsgivardeklaration(payload);

    await prisma.employerDeclaration.update({
      where: { id: declaration.id },
      data: {
        status: "SUBMITTED",
        externalRef: result.referenceId,
        responseJson: JSON.stringify(result),
        submittedAt: new Date()
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
