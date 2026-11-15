/**
 * POST /api/invitations/:id/resend   (owner only)
 *
 * Sends a new link for an unanswered invitation and gives it another 7 days.
 * The earlier link stops working.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwner } from "@/lib/auth/context";
import { accessErrorResponse, tooManyRequests } from "@/lib/auth/http";
import { sendInvitationEmail } from "@/lib/auth/invitationEmail";
import { resendInvitation } from "@/lib/auth/invitations";
import { INVITABLE_ROLES, type InvitableRole, Roles } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1).max(64);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOwner();
    const locale = await getRequestLocale();
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invalid invitation." }, { status: 422 });

    // Shares the per-business allowance with new invitations, plus a tighter one per invitation.
    const perBusiness = rateLimit({ key: `invite:business:${ctx.businessId}`, limit: 20, windowSeconds: 3600 });
    const perInvitation = rateLimit({ key: `invite:resend:${id.data}`, limit: 3, windowSeconds: 3600 });
    if (!perBusiness.allowed) return tooManyRequests(perBusiness, locale);
    if (!perInvitation.allowed) return tooManyRequests(perInvitation, locale);

    const { invitation, token } = await resendInvitation({
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      invitationId: id.data
    });

    const [business, inviter] = await Promise.all([
      prisma.business.findUnique({ where: { id: ctx.businessId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true, email: true } })
    ]);
    const role: InvitableRole = (INVITABLE_ROLES as readonly string[]).includes(invitation.role)
      ? (invitation.role as InvitableRole)
      : Roles.VIEWER;
    const sent = await sendInvitationEmail({
      to: invitation.email,
      token,
      businessName: business?.name ?? "Akunta",
      inviterName: inviter?.fullName || inviter?.email || null,
      role
    });

    return NextResponse.json({ ok: true, emailSent: sent.ok, expiresAt: invitation.expiresAt });
  } catch (error) {
    return accessErrorResponse(error, "Resend invitation");
  }
}
