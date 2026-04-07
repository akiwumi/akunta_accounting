import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { unlockPeriod } from "@/lib/accounting/period-locks";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { businessId } = await requireAuthContext();
    await unlockPeriod(businessId, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
