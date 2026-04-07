import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { businessId } = await requireAuthContext();
  const existing = await prisma.periodisationEntry.findFirst({
    where: { id: params.id, businessId }
  });
  if (!existing) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }
  await prisma.periodisationEntry.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
