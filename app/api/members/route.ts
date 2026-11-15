/**
 * GET /api/members
 *
 * Everyone with access to the current business. Any member may see the list;
 * unanswered invitations are shown to owners only.
 */

import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { accessErrorResponse } from "@/lib/auth/http";
import { listPendingInvitations } from "@/lib/auth/invitations";
import { listMembers } from "@/lib/auth/members";
import { Roles } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const [members, invitations] = await Promise.all([
      listMembers(ctx.businessId),
      ctx.role === Roles.OWNER ? listPendingInvitations(ctx.businessId) : Promise.resolve([])
    ]);
    return NextResponse.json({ role: ctx.role, userId: ctx.userId, members, invitations });
  } catch (error) {
    return accessErrorResponse(error, "List members");
  }
}
