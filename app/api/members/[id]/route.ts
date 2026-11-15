/**
 * PATCH  /api/members/:id   { role }   change a member's role   (owner only)
 * DELETE /api/members/:id              remove a member          (owner only)
 *
 * Removing ends that person's sessions in this business at once. The last
 * owner can be neither removed nor given a lesser role.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwner } from "@/lib/auth/context";
import { accessErrorResponse, readJson } from "@/lib/auth/http";
import { changeMemberRole, removeMember } from "@/lib/auth/members";
import { ALL_ROLES } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(64);
const roleSchema = z.object({ role: z.enum(ALL_ROLES as [string, ...string[]]) });

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const ctx = await requireOwner();
    const id = idSchema.safeParse((await params).id);
    const body = roleSchema.safeParse(await readJson(request));
    if (!id.success || !body.success) return NextResponse.json({ error: "A valid role is required." }, { status: 422 });

    const member = await changeMemberRole({
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      membershipId: id.data,
      role: body.data.role
    });
    return NextResponse.json({ ok: true, member });
  } catch (error) {
    return accessErrorResponse(error, "Change member role");
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const ctx = await requireOwner();
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invalid member." }, { status: 422 });

    const result = await removeMember({ businessId: ctx.businessId, actorUserId: ctx.userId, membershipId: id.data });
    return NextResponse.json({ ok: true, sessionsEnded: result.sessionsEnded });
  } catch (error) {
    return accessErrorResponse(error, "Remove member");
  }
}
