import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { fetchSkattekonto } from "@/lib/integrations/skatteverket/skattekonto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const business = await requireBusiness(businessId);

    const orgNumber = business.personnummer ?? business.vatNumber ?? business.skvActorId;
    if (!orgNumber) return NextResponse.json({ error: "No organisation number configured." }, { status: 422 });

    const account = await fetchSkattekonto(orgNumber);
    return NextResponse.json({
      balanceSEK: account.saldo / 100,
      transactions: account.poster.map((p) => ({
        ...p,
        beloppSEK: p.belopp / 100
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
