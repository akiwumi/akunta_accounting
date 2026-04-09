/**
 * BankID user resolution and session creation.
 *
 * On first BankID login the user is provisioned with a default Swedish sole-
 * trader business (matching what email registration does). On subsequent logins
 * the existing user and their first membership are used.
 */

import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createSession,
} from "@/lib/auth/session";
import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { Jurisdictions } from "@/lib/domain/enums";
import { prisma } from "@/lib/db";

export interface BankIdSessionResult {
  cookieName: string;
  cookieValue: string;
  cookieMaxAge: number;
  userId: string;
  businessId: string;
  isNewUser: boolean;
}

/**
 * Resolve or provision a user from a completed BankID authentication, then
 * create an app session and return everything needed to set the auth cookie.
 */
export async function resolveOrProvisionBankIdUser(
  personalNumber: string,
  fullName: string
): Promise<BankIdSessionResult> {
  let isNewUser = false;

  // ── Find or create user ──────────────────────────────────────────────────
  let user = await prisma.user.findUnique({
    where: { bankIdSubject: personalNumber },
  });

  if (!user) {
    isNewUser = true;
    // Derive a placeholder email from the personalNumber so the unique
    // constraint on email is satisfied. The user can add a real email later.
    const placeholderEmail = `bankid.${personalNumber}@users.akunta.internal`;

    const businessName = `${fullName}s företag`;

    const result = await prisma.user.create({
      data: {
        email: placeholderEmail,
        fullName: fullName.trim(),
        bankIdSubject: personalNumber,
        isActive: true,
        memberships: {
          create: {
            role: "owner",
            business: {
              create: {
                name: businessName,
                orgType: "sole_trader",
                jurisdiction: Jurisdictions.SWEDEN,
                bookkeepingMethod: "kontantmetoden",
                vatRegistered: true,
                vatFrequency: "yearly",
                fiscalYearStart: new Date(Date.UTC(new Date().getFullYear(), 0, 1)),
                baseCurrency: "SEK",
                locale: "sv",
                invoiceNumberPattern: "INV-{YYYY}-{SEQ:4}",
                nextInvoiceSequence: 1,
                accounts: {
                  create: swedishSoleTraderDefaultAccounts.map((a) => ({
                    code: a.code,
                    name: a.name,
                    type: a.type,
                    vatCode: a.vatCode,
                    isSystem: a.isSystem ?? false,
                  })),
                },
                taxConfig: {
                  create: {
                    municipalTaxRate: 0.32,
                    socialContributionRate: 0.2897,
                    generalDeductionRate: 0.25,
                    vatStandardRate: 0.25,
                    vatReducedRateFood: 0.12,
                    vatReducedRateCulture: 0.06,
                  },
                },
              },
            },
          },
        },
      },
      include: {
        memberships: {
          include: { business: true },
          take: 1,
        },
      },
    });

    const businessId = result.memberships[0]?.businessId;
    if (!businessId) {
      throw new Error("New BankID user was created without a business membership.");
    }

    user = result;
    const token = await createSession(user.id, businessId);
    return {
      cookieName: AUTH_COOKIE_NAME,
      cookieValue: token,
      cookieMaxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
      userId: user.id,
      businessId,
      isNewUser: true,
    };
  }

  // ── Existing user — find their first business ────────────────────────────
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    throw new Error("BankID user has no business membership. Contact support.");
  }

  const token = await createSession(user.id, membership.businessId);
  return {
    cookieName: AUTH_COOKIE_NAME,
    cookieValue: token,
    cookieMaxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    userId: user.id,
    businessId: membership.businessId,
    isNewUser,
  };
}
