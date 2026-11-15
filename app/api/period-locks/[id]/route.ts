import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { unlockPeriod } from "@/lib/accounting/period-locks";
import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { prisma } from "@/lib/db";

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { businessId, userId } = await requireAuthContext();
    const lock = await unlockPeriod(businessId, params.id);
    // Reopening a closed period must leave a trace.
    await writeLedgerAudit(prisma, {
      businessId,
      userId,
      entityType: "PeriodLock",
      entityId: params.id,
      action: "UNLOCK",
      before: { periodStart: lock.periodStart, periodEnd: lock.periodEnd }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
