/**
 * POST /api/members/leave
 *
 * The signed-in person gives up their own access to the current business.
 * Open to every role (an accountant can drop a client); the last owner cannot leave.
 */

import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { clearSessionCookies } from "@/lib/auth/cookies";
import { accessErrorResponse } from "@/lib/auth/http";
import { leaveBusiness } from "@/lib/auth/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const ctx = await requireAuthContext();
    await leaveBusiness({ businessId: ctx.businessId, userId: ctx.userId });
    // Their sessions in this business are gone, including this one.
    const response = NextResponse.json({ ok: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return accessErrorResponse(error, "Leave business");
  }
}
