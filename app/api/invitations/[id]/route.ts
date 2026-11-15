/**
 * DELETE /api/invitations/:id   withdraw an unanswered invitation   (owner only)
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwner } from "@/lib/auth/context";
import { accessErrorResponse } from "@/lib/auth/http";
import { revokeInvitation } from "@/lib/auth/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(64);

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOwner();
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invalid invitation." }, { status: 422 });

    await revokeInvitation({ businessId: ctx.businessId, actorUserId: ctx.userId, invitationId: id.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error, "Revoke invitation");
  }
}
