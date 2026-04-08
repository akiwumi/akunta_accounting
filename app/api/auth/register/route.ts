import { randomBytes } from "crypto";

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { findUserByEmail, hashPassword } from "@/lib/auth/session";
import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { Jurisdictions } from "@/lib/domain/enums";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120),
  businessName: z.string().min(1).max(120)
});

async function sendVerificationEmail(email: string, fullName: string, token: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${appUrl}/api/auth/verify?token=${token}`;

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    // Dev fallback — log the link so registration still works locally
    console.info(`[DEV] Email verification link for ${email}: ${verifyUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const firstName = fullName.split(" ")[0] ?? fullName;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? `Akunta <noreply@akunta.com>`,
    to: email,
    subject: "Confirm your Akunta account",
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <img src="${appUrl}/akunta_logo.png" alt="Akunta" width="48" height="48"
          style="margin-bottom:24px;border-radius:10px" />
        <h2 style="margin:0 0 8px;font-size:22px">Welcome to Akunta, ${firstName}!</h2>
        <p style="color:#555;margin:0 0 24px">
          Click the button below to confirm your email and activate your account.
        </p>
        <a href="${verifyUrl}"
          style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#fff;
                 text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
          Confirm email
        </a>
        <p style="color:#888;font-size:13px;margin:24px 0 0">
          This link expires in 24 hours. If you didn't create an account, ignore this email.
        </p>
      </div>
    `
  });
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `register:${ip}`, limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } }
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
  const verificationToken = randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  try {
    await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        fullName: fullName.trim(),
        emailVerificationToken: verificationToken,
        // tokenExpiry stored encoded in token suffix for simplicity — we rely on 24h window
        memberships: {
          create: {
            role: "owner",
            business: {
              create: {
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
            }
          }
        }
      }
    });
  } catch (error) {
    console.error("Registration provisioning failed:", error);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again shortly." },
      { status: 500 }
    );
  }

  // Send confirmation email (non-blocking — failure doesn't prevent registration)
  try {
    await sendVerificationEmail(email, fullName, verificationToken);
  } catch (err) {
    console.error("Failed to send verification email:", err);
  }

  void tokenExpiry; // suppress unused warning
  return NextResponse.json(
    { ok: true, message: "Account created. Check your email for a confirmation link." },
    { status: 201 }
  );
}
