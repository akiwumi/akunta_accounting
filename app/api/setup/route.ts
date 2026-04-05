import { NextResponse } from "next/server";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const business = await ensureBusiness();

  const accountCount = await prisma.account.count({
    where: { businessId: business.id }
  });

  return NextResponse.json({
    businessId: business.id,
    businessName: business.name,
    jurisdiction: business.jurisdiction,
    accountCount
  });
}
