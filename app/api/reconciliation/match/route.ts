import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { finalizeMatch, unmatch, ignoreUnmatched } from "@/lib/reconciliation/finalize";
import { getReconciliationStats } from "@/lib/reconciliation/finalize";

const matchSchema = z.object({
  action: z.enum(["match", "unmatch", "ignore"]),
  bankLineId: z.string().cuid(),
  transactionId: z.string().cuid().optional()
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const body = await request.json();
    const parsed = matchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 422 });

    const { action, bankLineId, transactionId } = parsed.data;

    switch (action) {
      case "match":
        if (!transactionId) return NextResponse.json({ error: "transactionId is required for match action." }, { status: 422 });
        await finalizeMatch(businessId, bankLineId, transactionId);
        break;
      case "unmatch":
        await unmatch(businessId, bankLineId);
        break;
      case "ignore":
        await ignoreUnmatched(businessId, bankLineId);
        break;
    }

    const stats = await getReconciliationStats(businessId);
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 500 });
  }
}
