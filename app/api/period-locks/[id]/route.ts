import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { unlockPeriod } from "@/lib/accounting/period-locks";

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { businessId } = await requireAuthContext();
    await unlockPeriod(businessId, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
