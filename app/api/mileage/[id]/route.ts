import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { businessId } = await requireAuthContext();
  const existing = await prisma.mileageEntry.findFirst({
    where: { id: params.id, businessId }
  });
  if (!existing) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }
  await prisma.mileageEntry.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
