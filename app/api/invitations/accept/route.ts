/**
 * POST /api/invitations/accept
 *
 * Signed in:      { token }                      accepts as the signed-in person,
 *                                                only if their email is the invited one.
 * Not signed in:  { token, fullName, password }  creates the account for the invited
 *                                                address (confirmed, with no business of
 *                                                its own) and accepts.
 *
 * Either way the session ends up in the business the invitation is for.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserContext } from "@/lib/auth/context";
import { setBusinessCookies, setSessionCookies } from "@/lib/auth/cookies";
import { accessErrorResponse, currentSessionToken, readJson, tooManyRequests } from "@/lib/auth/http";
import { acceptInvitation, registerWithInvitation } from "@/lib/auth/invitations";
import { createSession, switchSessionBusiness } from "@/lib/auth/session";
import { getRequestLocale } from "@/lib/i18n/locale";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().trim().min(32).max(128),
  fullName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(128).optional()
});

export async function POST(request: Request) {
  try {
    const locale = await getRequestLocale();
    const rl = rateLimit({ key: `invite-accept:${getClientIp(request)}`, limit: 10, windowSeconds: 600 });
    if (!rl.allowed) return tooManyRequests(rl, locale);

    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: locale === "sv" ? "Kontrollera uppgifterna och försök igen." : "Check the details and try again." },
        { status: 422 }
      );
    }
    const { token, fullName, password } = parsed.data;

    const user = await getUserContext();
    const sessionToken = await currentSessionToken();

    if (user && sessionToken) {
      const accepted = await acceptInvitation({ token, userId: user.userId });
      const switched = await switchSessionBusiness({
        sessionId: user.sessionId,
        userId: user.userId,
        businessId: accepted.businessId
      });
      const response = NextResponse.json({ ok: true, businessId: accepted.businessId });
      await setBusinessCookies(response, sessionToken, switched);
      return response;
    }

    if (!fullName || !password) {
      return NextResponse.json(
        {
          error:
            locale === "sv"
              ? "Ange ditt namn och ett lösenord på minst 8 tecken."
              : "Enter your name and a password of at least 8 characters."
        },
        { status: 422 }
      );
    }

    const accepted = await registerWithInvitation({ token, fullName, password });
    const newSessionToken = await createSession(accepted.userId, accepted.businessId);
    const response = NextResponse.json({ ok: true, businessId: accepted.businessId }, { status: 201 });
    setSessionCookies(response, newSessionToken);
    await setBusinessCookies(response, newSessionToken, { businessId: accepted.businessId, role: accepted.role });
    return response;
  } catch (error) {
    return accessErrorResponse(error, "Accept invitation");
  }
}
