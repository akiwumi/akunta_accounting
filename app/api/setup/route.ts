import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { businessId } = await requireAuthContext();
    const business = await requireBusiness(businessId);
    const accountCount = await prisma.account.count({ where: { businessId } });
    return NextResponse.json({
      businessId: business.id,
      businessName: business.name,
      jurisdiction: business.jurisdiction,
      accountCount
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
