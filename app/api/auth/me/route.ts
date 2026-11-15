import { NextResponse } from "next/server";

import { getAuthContext, getUserContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUserContext();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // The business is only reported when the person is a member of it.
  const ctx = await getAuthContext();

  return NextResponse.json({
    user: { id: user.userId, email: user.email, fullName: user.fullName, isActive: true },
    businessId: ctx?.businessId ?? null,
    role: ctx?.role ?? null
  });
}
