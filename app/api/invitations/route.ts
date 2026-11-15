/**
 * POST /api/invitations   { email, role }   (owner only)
 *
 * Invites a person to the current business and emails them a single-use link
 * that is valid for 7 days. The link is never returned to the caller.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwner } from "@/lib/auth/context";
import { accessErrorResponse, readJson, tooManyRequests } from "@/lib/auth/http";
import { sendInvitationEmail } from "@/lib/auth/invitationEmail";
import { createInvitation } from "@/lib/auth/invitations";
import { INVITABLE_ROLES } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(INVITABLE_ROLES).default("accountant")
});

export async function POST(request: Request) {
  try {
    const ctx = await requireOwner();
    const locale = await getRequestLocale();

    // Each invitation sends an email, so creation is limited per business and per address.
    const perBusiness = rateLimit({ key: `invite:business:${ctx.businessId}`, limit: 20, windowSeconds: 3600 });
    const perIp = rateLimit({ key: `invite:ip:${getClientIp(request)}`, limit: 30, windowSeconds: 3600 });
    if (!perBusiness.allowed) return tooManyRequests(perBusiness, locale);
    if (!perIp.allowed) return tooManyRequests(perIp, locale);

    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: locale === "sv" ? "Ange en giltig e-postadress." : "Enter a valid email address." },
        { status: 422 }
      );
    }

    const { invitation, token } = await createInvitation({
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      email: parsed.data.email,
      role: parsed.data.role
    });

    const [business, inviter] = await Promise.all([
      prisma.business.findUnique({ where: { id: ctx.businessId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true, email: true } })
    ]);
    const sent = await sendInvitationEmail({
      to: invitation.email,
      token,
      businessName: business?.name ?? "Akunta",
      inviterName: inviter?.fullName || inviter?.email || null,
      role: parsed.data.role
    });

    return NextResponse.json(
      {
        ok: true,
        emailSent: sent.ok,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          expired: false
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return accessErrorResponse(error, "Create invitation");
  }
}
