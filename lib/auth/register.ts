import { randomBytes } from "crypto";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { prisma } from "@/lib/db";
import { Jurisdictions } from "@/lib/domain/enums";
import { getAuthEmailProvider, sendSupabaseConfirmationEmail } from "@/lib/auth/supabase";
import { findUserByEmail, hashPassword } from "@/lib/auth/session";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(120)
});

async function sendVerificationEmail(email: string, fullName: string, token: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const welcomeUrl = `${appUrl}/welcome?token=${encodeURIComponent(token)}`;
  const logoUrl = `${appUrl}/akunta_logo.png`;

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.info(`[DEV] Email verification link for ${email}: ${welcomeUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const firstName = fullName.split(" ")[0] ?? fullName;
  const safeFirstName = escapeHtml(firstName);
  const safeWelcomeUrl = escapeHtml(welcomeUrl);
  const safeLogoUrl = escapeHtml(logoUrl);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "Akunta <noreply@akunta.com>",
    to: email,
    subject: "Bekräfta ditt Akunta-konto | Confirm your Akunta account",
    text: [
      `Hej ${firstName},`,
      "",
      "Tack för att du har skapat ett konto i Akunta.",
      "Öppna länken nedan för att bekräfta din e-postadress och komma till din välkomstsida:",
      welcomeUrl,
      "",
      "Akunta hjälper dig att hålla ordning på bokföring, moms, kvitton och fakturor så att du kan fokusera på din verksamhet.",
      "",
      `Hi ${firstName},`,
      "",
      "Thanks for creating your Akunta account.",
      "Open the link below to confirm your email address and continue to your welcome page:",
      welcomeUrl,
      "",
      "Akunta helps you stay on top of bookkeeping, VAT, receipts, and invoices so you can focus on your business.",
      "",
      "Om du inte skapade kontot kan du ignorera det här mejlet.",
      "If you didn't create this account, you can ignore this email."
    ].join("\n"),
    html: `
      <div style="margin:0;background:#f5f2eb;padding:32px 16px;font-family:Arial,sans-serif;color:#203033">
        <div style="max-width:600px;margin:0 auto;background:#fffaf4;border:1px solid #e7dfd2;border-radius:24px;padding:36px 32px;box-shadow:0 18px 48px rgba(54,66,68,0.08)">
          <img src="${safeLogoUrl}" alt="Akunta" width="56" height="56"
            style="display:block;margin:0 0 20px;border-radius:14px" />
          <p style="margin:0 0 8px;color:#6b7a7d;font-size:13px;letter-spacing:0.08em;text-transform:uppercase">
            Akunta
          </p>
          <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;color:#243336">
            Hej ${safeFirstName}, varmt välkommen till Akunta.
          </h1>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#47585b">
            Bekräfta din e-postadress för att öppna din välkomstsida och komma vidare till din dashboard.
            Akunta hjälper dig att hålla ordning på bokföring, moms, kvitton och fakturor, så att du kan fokusera på ditt företag.
          </p>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:#47585b">
            Hi ${safeFirstName}, welcome to Akunta.
            Confirm your email address to open your welcome page and continue to your dashboard.
            Akunta helps you stay on top of bookkeeping, VAT, receipts, and invoices so you can focus on running your business.
          </p>
          <a href="${safeWelcomeUrl}"
            style="display:inline-block;padding:14px 24px;background:#364244;color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px">
            Öppna välkomstsidan / Open welcome page
          </a>
          <div style="margin:28px 0 0;padding:18px 20px;background:#f3efe6;border-radius:18px;color:#5b686b;font-size:14px;line-height:1.7">
            <strong style="color:#243336">Direktlänk / Direct link</strong><br />
            <a href="${safeWelcomeUrl}" style="color:#364244;word-break:break-all">${safeWelcomeUrl}</a>
          </div>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#718083">
            Om du inte skapade kontot kan du ignorera det här mejlet.<br />
            If you didn&apos;t create this account, you can ignore this email.
          </p>
        </div>
      </div>
    `
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function handleRegisterRequest(request: Request) {
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
  const emailProvider = getAuthEmailProvider();

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.emailVerifiedAt) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const verificationToken =
      emailProvider === "smtp"
        ? existing.emailVerificationToken ?? randomBytes(32).toString("hex")
        : null;

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        fullName,
        ...(verificationToken ? { emailVerificationToken: verificationToken } : {})
      }
    });

    try {
      if (emailProvider === "supabase") {
        await sendSupabaseConfirmationEmail({ email, fullName, password });
      } else if (verificationToken) {
        await sendVerificationEmail(email, fullName, verificationToken);
      }
    } catch (error) {
      console.error("Failed to resend verification email:", error);
      return NextResponse.json(
        {
          error:
            "Your account exists, but we couldn't resend the confirmation email just now. Please try again shortly."
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "Account already exists. We sent a fresh confirmation link to your email." },
      { status: 200 }
    );
  }

  const passwordHash = await hashPassword(password);
  const verificationToken = emailProvider === "smtp" ? randomBytes(32).toString("hex") : null;

  try {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        emailVerificationToken: verificationToken,
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
                invoiceSenderName: businessName,
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      console.error("Registration database initialization failed:", error);
      return NextResponse.json(
        { error: "Registration is temporarily unavailable. Please try again shortly." },
        { status: 503 }
      );
    }
    console.error("Registration provisioning failed:", error);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again shortly." },
      { status: 500 }
    );
  }

  try {
    if (emailProvider === "supabase") {
      await sendSupabaseConfirmationEmail({ email, fullName, password });
    } else if (verificationToken) {
      await sendVerificationEmail(email, fullName, verificationToken);
    }
  } catch (error) {
    console.error("Failed to send verification email:", error);
    return NextResponse.json(
      {
        error:
          "Your account was created, but we couldn't send the confirmation email. Try registering again to resend it."
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { ok: true, message: "Account created. Check your email for a confirmation link." },
    { status: 201 }
  );
}
