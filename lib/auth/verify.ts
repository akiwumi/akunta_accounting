import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export type EmailVerificationResult =
  | {
      ok: true;
      businessId: string;
      firstName: string;
      sessionToken: string;
      userId: string;
    }
  | {
      ok: false;
      code: "invalid_token" | "no_business";
    };

export async function verifyEmailToken(token: string): Promise<EmailVerificationResult> {
  if (!token || token.length < 32) {
    return { ok: false, code: "invalid_token" };
  }

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
    include: { memberships: { take: 1 } }
  });

  if (!user) {
    return { ok: false, code: "invalid_token" };
  }

  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationToken: null }
    });
  }

  const businessId = user.memberships[0]?.businessId;
  if (!businessId) {
    return { ok: false, code: "no_business" };
  }

  const sessionToken = await createSession(user.id, businessId);
  const firstName = user.fullName?.split(" ")[0] ?? "there";

  return {
    ok: true,
    businessId,
    firstName,
    sessionToken,
    userId: user.id
  };
}
