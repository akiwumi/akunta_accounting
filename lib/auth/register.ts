import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { swedishSoleTraderDefaultAccounts } from "@/lib/accounting/chartOfAccounts";
import { createSmtpTransport, getDefaultEmailFromAddress, getSmtpConfig } from "@/lib/email/smtp";
import { prisma } from "@/lib/db";
import { Jurisdictions } from "@/lib/domain/enums";
import { getAuthEmailProvider, sendSupabaseConfirmationEmail } from "@/lib/auth/supabase";
import { logger } from "@/lib/observability/logger";
import { findUserByEmail, hashPassword } from "@/lib/auth/session";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(120)
});

function getMailErrorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  const mailError = error as Error & {
    address?: string;
    code?: string;
    command?: string;
    port?: number;
    response?: string;
    responseCode?: number;
    syscall?: string;
  };

  return {
    error: error.message,
    code: mailError.code,
    responseCode: mailError.responseCode,
    response: mailError.response,
    command: mailError.command,
    syscall: mailError.syscall,
    address: mailError.address,
    port: mailError.port
  };
}

async function sendVerificationEmail(email: string, fullName: string, token: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const confirmationUrl = `${appUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const logoUrl = `${appUrl}/akunta_logo.png`;

  const firstName = fullName.split(" ")[0] ?? fullName;
  const safeFirstName = escapeHtml(firstName);
  const safeConfirmationUrl = escapeHtml(confirmationUrl);
  const logoSrc = escapeHtml(logoUrl);

  const html = `
    <div style="margin:0;background:#f5f2eb;padding:32px 16px;font-family:Arial,sans-serif;color:#203033">
      <div style="max-width:600px;margin:0 auto;background:#fffaf4;border:1px solid #e7dfd2;border-radius:24px;padding:36px 32px;box-shadow:0 18px 48px rgba(54,66,68,0.08)">
        <img src="${logoSrc}" alt="Akunta" width="56" height="56"
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
        <a href="${safeConfirmationUrl}"
          style="display:inline-block;padding:14px 24px;background:#364244;color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px">
          Öppna välkomstsidan / Open welcome page
        </a>
        <div style="margin:28px 0 0;padding:18px 20px;background:#f3efe6;border-radius:18px;color:#5b686b;font-size:14px;line-height:1.7">
          <strong style="color:#243336">Direktlänk / Direct link</strong><br />
          <a href="${safeConfirmationUrl}" style="color:#364244;word-break:break-all">${safeConfirmationUrl}</a>
        </div>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#718083">
          Om du inte skapade kontot kan du ignorera det här mejlet.<br />
          If you didn&apos;t create this account, you can ignore this email.
        </p>
      </div>
    </div>
  `;

  const text = [
    `Hej ${firstName},`,
    "",
    "Tack för att du har skapat ett konto i Akunta.",
    "Öppna länken nedan för att bekräfta din e-postadress och komma till din välkomstsida:",
    confirmationUrl,
    "",
    "Akunta hjälper dig att hålla ordning på bokföring, moms, kvitton och fakturor så att du kan fokusera på din verksamhet.",
    "",
    `Hi ${firstName},`,
    "",
    "Thanks for creating your Akunta account.",
    "Open the link below to confirm your email address and continue to your welcome page:",
    confirmationUrl,
    "",
    "Akunta helps you stay on top of bookkeeping, VAT, receipts, and invoices so you can focus on your business.",
    "",
    "Om du inte skapade kontot kan du ignorera det här mejlet.",
    "If you didn't create this account, you can ignore this email."
  ].join("\n");

  const smtp = getSmtpConfig();
  if (!smtp.ok) {
    if (process.env.NODE_ENV === "production") {
      logger.error("auth.verification_email.smtp_not_configured", {
        email,
        appUrl,
        missing: smtp.missing
      });
      throw new Error(smtp.error);
    }

    console.info(`[DEV] Email verification link for ${email}: ${confirmationUrl}`);
    return;
  }

  const transporter = createSmtpTransport(smtp.config);
  const from = getDefaultEmailFromAddress();

  // Attempt to attach logo inline; non-fatal if it fails
  let logoSrcFinal = logoSrc;
  let attachments: { filename: string; content: Buffer; cid: string }[] | undefined;
  try {
    const logoBuffer = await readFile(path.join(process.cwd(), "public", "akunta_logo.png"));
    attachments = [{ filename: "akunta_logo.png", content: logoBuffer, cid: "akunta-confirmation-logo" }];
    logoSrcFinal = "cid:akunta-confirmation-logo";
  } catch {
    attachments = undefined;
  }

  const htmlWithLogo = html.replace(escapeHtml(logoUrl), logoSrcFinal);

  try {
    await transporter.sendMail({
      from,
      to: email,
      subject: "Bekräfta ditt Akunta-konto | Confirm your Akunta account",
      attachments,
      text,
      html: htmlWithLogo
    });
  } catch (error) {
    logger.error("auth.verification_email.smtp_failed", {
      email,
      appUrl,
      confirmationUrl,
      emailFrom: from,
      smtpHost: smtp.config.host,
      smtpPort: smtp.config.port,
      ...getMailErrorDetails(error)
    });
    throw error;
  }

  logger.info("auth.verification_email.sent", {
    email,
    appUrl,
    provider: "smtp",
    smtpHost: smtp.config.host
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
      logger.error("auth.register.resend_verification_failed", {
        email,
        emailProvider,
        ...getMailErrorDetails(error)
      });
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
    logger.error("auth.register.initial_verification_failed", {
      email,
      emailProvider,
      ...getMailErrorDetails(error)
    });
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
