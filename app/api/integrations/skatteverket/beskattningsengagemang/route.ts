import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { fetchBeskattningsengagemang } from "@/lib/integrations/skatteverket/beskattningsengagemang";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const business = await requireBusiness(businessId);
    const orgNumber = business.personnummer ?? business.vatNumber ?? business.skvActorId;
    if (!orgNumber) return NextResponse.json({ error: "No organisation number configured. Add it in Settings." }, { status: 422 });

    const result = await fetchBeskattningsengagemang(orgNumber);

    // Persist the SKV actor ID if we found a result
    if (result.found && result.data) {
      await prisma.business.update({
        where: { id: businessId },
        data: { skvActorId: result.data.organisationsnummer, skvAuthorizationStatus: "ACTIVE" }
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
