import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createSession,
  findUserByEmail,
  hashPassword
} from "@/lib/auth/session";
import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { Jurisdictions } from "@/lib/domain/enums";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120),
  businessName: z.string().min(1).max(120)
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `register:${ip}`, limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) }
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Validation error." }, { status: 422 });
  }

  const { email, password, fullName, businessName } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  // Create user, business, and membership atomically
  const { user, business } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        fullName: fullName.trim()
      }
    });

    const business = await tx.business.create({
      data: {
        name: businessName.trim(),
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
        invoiceSenderName: businessName.trim(),
        accounts: {
          create: swedishSoleTraderDefaultAccounts.map((a) => ({
            code: a.code,
            name: a.name,
            type: a.type,
            vatCode: a.vatCode,
            isSystem: a.isSystem ?? false
          }))
        },
        taxConfig: {
          create: {
            municipalTaxRate: 0.32,
            socialContributionRate: 0.2897,
            generalDeductionRate: 0.25,
            vatStandardRate: 0.25,
            vatReducedRateFood: 0.12,
            vatReducedRateCulture: 0.06
          }
        }
      }
    });

    await tx.membership.create({
      data: { userId: user.id, businessId: business.id, role: "owner" }
    });

    return { user, business };
  });

  const token = await createSession(user.id, business.id);

  const response = NextResponse.json({ ok: true, userId: user.id, businessId: business.id }, { status: 201 });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });

  return response;
}
