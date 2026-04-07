import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, getSessionByToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const session = await getSessionByToken(token);
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, fullName: true, isActive: true }
  });

  if (!user || !user.isActive) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  return NextResponse.json({ user, businessId: session.businessId });
}
