import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { syncKundhandelserToDB } from "@/lib/integrations/skatteverket/kundhandelser";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET — return stored tax events for this business
export async function GET() {
  try {
    const { businessId } = await requireAuthContext();
    const events = await prisma.taxEvent.findMany({
      where: { businessId },
      orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }]
    });
    return NextResponse.json(events);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}

// POST — trigger a sync from Skatteverket
export async function POST() {
  try {
    const { businessId } = await requireAuthContext();
    const business = await requireBusiness(businessId);

    const orgNumber = business.personnummer ?? business.vatNumber ?? business.skvActorId;
    if (!orgNumber) return NextResponse.json({ error: "No organisation number configured." }, { status: 422 });

    const synced = await syncKundhandelserToDB(businessId, orgNumber);
    return NextResponse.json({ synced });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
