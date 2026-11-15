import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { Jurisdictions } from "@/lib/domain/enums";
import {
  mergeBusinessWithLocalSettings,
  readLocalSettings,
  type LocalBusinessSettings,
  writeLocalSettings
} from "@/lib/data/localSettings";
import { sanitizeInvoiceNumberPattern } from "@/lib/invoices/numbering";
import {
  type PaymentAccountField,
  parsePaymentAccount,
  paymentAccountMessage
} from "@/lib/invoices/payment-accounts";
import { getRequestLocale } from "@/lib/i18n/locale";

const updateSchema = z.object({
  name: z.string().min(2).max(120),
  jurisdiction: z.enum([Jurisdictions.SWEDEN, Jurisdictions.EU_GENERIC, Jurisdictions.UK]),
  locale: z.enum(["en", "sv"]).default("en"),
  baseCurrency: z.enum(["SEK", "EUR", "GBP"]).default("SEK"),
  bookkeepingMethod: z.enum(["kontantmetoden", "fakturametoden"]).default("kontantmetoden"),
  vatRegistered: z.boolean().default(true),
  vatFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("yearly"),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  // Swedish registration fields
  sniCode: z.string().trim().max(20).optional().or(z.literal("")),
  vatNumber: z.string().trim().max(30).optional().or(z.literal("")),
  fSkattRegistered: z.boolean().default(true),
  personnummer: z.string().trim().max(20).optional().or(z.literal("")),
  // Invoice fields
  invoiceNumberPattern: z.string().trim().min(1).max(80).default("INV-{YYYY}-{SEQ:4}"),
  invoiceSenderName: z.string().trim().max(120).optional(),
  invoiceSenderAddress: z.string().trim().max(500).optional(),
  invoiceSenderOrgNumber: z.string().trim().max(80).optional(),
  invoiceSenderEmail: z.string().trim().email().max(120).optional().or(z.literal("")),
  invoiceSenderPhone: z.string().trim().max(80).optional(),
  invoiceSenderWebsite: z.string().trim().max(120).optional(),
  invoiceEmailFrom: z.string().trim().email().max(120).optional().or(z.literal("")),
  invoiceDefaultLogo: z.string().trim().max(1_500_000).optional(),
  invoiceDefaultSignature: z.string().trim().max(1_500_000).optional(),
  // How customers pay, payment terms, quotes and reminders. All optional, so
  // a client that does not send them leaves the stored values untouched.
  bankgiro: z.string().trim().max(20).optional(),
  plusgiro: z.string().trim().max(20).optional(),
  iban: z.string().trim().max(42).optional(),
  bic: z.string().trim().max(14).optional(),
  swishNumber: z.string().trim().max(20).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(120).optional(),
  quoteNumberPattern: z.string().trim().min(1).max(80).optional(),
  invoiceReminderEnabled: z.boolean().optional(),
  invoiceReminderDaysAfterDue: z.number().int().min(1).max(60).optional(),
  // Tax rates
  municipalTaxRate: z.number().min(0).max(1),
  socialContributionRate: z.number().min(0).max(1),
  generalDeductionRate: z.number().min(0).max(1)
});

export const dynamic = "force-dynamic";

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export async function GET() {
  const { businessId } = await requireAuthContext();
  const fullBusiness = await prisma.business.findUnique({
    where: { id: businessId },
    include: { taxConfig: true }
  });
  if (!fullBusiness) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  const localSettings = await readLocalSettings();
  return NextResponse.json(mergeBusinessWithLocalSettings(fullBusiness, localSettings));
}

export async function PUT(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    let payload: z.infer<typeof updateSchema>;
    try {
      payload = updateSchema.parse(body);
    } catch (err) {
      const issue = err instanceof z.ZodError ? err.issues[0] : undefined;
      return NextResponse.json(
        {
          error: issue
            ? `${issue.path.join(".")}: ${issue.message}`
            : err instanceof Error
              ? err.message
              : "Validation error"
        },
        { status: 422 }
      );
    }

    // Payment accounts: check digits are verified here so a typo never reaches an invoice.
    const locale = await getRequestLocale();
    const paymentAccounts: Partial<Record<PaymentAccountField, string | null>> = {};
    const accountFields: PaymentAccountField[] = ["bankgiro", "plusgiro", "iban", "bic", "swishNumber"];
    for (const field of accountFields) {
      const raw = payload[field];
      if (raw === undefined) continue;
      if (raw === "") {
        paymentAccounts[field] = null;
        continue;
      }
      const result = parsePaymentAccount(field, raw);
      if (!result.ok) {
        return NextResponse.json(
          { error: paymentAccountMessage(field, result.reason, locale), field },
          { status: 422 }
        );
      }
      paymentAccounts[field] = result.value;
    }

    const localPayload: LocalBusinessSettings = {
      name: payload.name,
      jurisdiction: payload.jurisdiction,
      locale: payload.locale,
      baseCurrency: payload.baseCurrency,
      bookkeepingMethod: payload.bookkeepingMethod,
      vatRegistered: payload.vatRegistered,
      vatFrequency: payload.vatFrequency,
      fiscalYearStartMonth: payload.fiscalYearStartMonth,
      sniCode: payload.sniCode ?? "",
      vatNumber: payload.vatNumber ?? "",
      fSkattRegistered: payload.fSkattRegistered,
      personnummer: payload.personnummer ?? "",
      invoiceNumberPattern: sanitizeInvoiceNumberPattern(payload.invoiceNumberPattern),
      invoiceSenderName: payload.invoiceSenderName ?? "",
      invoiceSenderAddress: payload.invoiceSenderAddress ?? "",
      invoiceSenderOrgNumber: payload.invoiceSenderOrgNumber ?? "",
      invoiceSenderEmail: payload.invoiceSenderEmail ?? "",
      invoiceSenderPhone: payload.invoiceSenderPhone ?? "",
      invoiceSenderWebsite: payload.invoiceSenderWebsite ?? "",
      invoiceEmailFrom: payload.invoiceEmailFrom ?? "",
      invoiceDefaultLogo: payload.invoiceDefaultLogo ?? "",
      invoiceDefaultSignature: payload.invoiceDefaultSignature ?? "",
      municipalTaxRate: payload.municipalTaxRate,
      socialContributionRate: payload.socialContributionRate,
      generalDeductionRate: payload.generalDeductionRate
    };

    const { businessId } = await requireAuthContext();
    let localSaveError: string | null = null;

    try {
      // Persist a local fallback when possible, but do not let a read-only filesystem block the primary save.
      await writeLocalSettings(localPayload);
    } catch (error) {
      localSaveError = toErrorMessage(error, "Failed to save the local settings fallback.");
    }

    try {
      const updated = await prisma.business.update({
        where: { id: businessId },
        data: {
          name: payload.name,
          jurisdiction: payload.jurisdiction,
          locale: payload.locale,
          baseCurrency: payload.baseCurrency,
          bookkeepingMethod: payload.bookkeepingMethod,
          vatRegistered: payload.vatRegistered,
          vatFrequency: payload.vatFrequency,
          fiscalYearStart: new Date(Date.UTC(2000, payload.fiscalYearStartMonth - 1, 1, 0, 0, 0, 0)),
          sniCode: payload.sniCode?.trim() || null,
          vatNumber: payload.vatNumber?.trim() || null,
          fSkattRegistered: payload.fSkattRegistered,
          personnummer: payload.personnummer?.trim() || null,
          invoiceNumberPattern: sanitizeInvoiceNumberPattern(payload.invoiceNumberPattern),
          invoiceSenderName: payload.invoiceSenderName?.trim() || null,
          invoiceSenderAddress: payload.invoiceSenderAddress?.trim() || null,
          invoiceSenderOrgNumber: payload.invoiceSenderOrgNumber?.trim() || null,
          invoiceSenderEmail: payload.invoiceSenderEmail?.trim() || null,
          invoiceSenderPhone: payload.invoiceSenderPhone?.trim() || null,
          invoiceSenderWebsite: payload.invoiceSenderWebsite?.trim() || null,
          invoiceEmailFrom: payload.invoiceEmailFrom?.trim() || null,
          invoiceDefaultLogo: payload.invoiceDefaultLogo?.trim() || null,
          invoiceDefaultSignature: payload.invoiceDefaultSignature?.trim() || null,
          ...paymentAccounts,
          defaultPaymentTermsDays: payload.defaultPaymentTermsDays,
          quoteNumberPattern: payload.quoteNumberPattern
            ? sanitizeInvoiceNumberPattern(payload.quoteNumberPattern)
            : undefined,
          invoiceReminderEnabled: payload.invoiceReminderEnabled,
          invoiceReminderDaysAfterDue: payload.invoiceReminderDaysAfterDue,
          taxConfig: {
            upsert: {
              create: {
                municipalTaxRate: payload.municipalTaxRate,
                socialContributionRate: payload.socialContributionRate,
                generalDeductionRate: payload.generalDeductionRate
              },
              update: {
                municipalTaxRate: payload.municipalTaxRate,
                socialContributionRate: payload.socialContributionRate,
                generalDeductionRate: payload.generalDeductionRate
              }
            }
          }
        },
        include: {
          taxConfig: true
        }
      });

      return NextResponse.json({
        ...updated,
        savedLocally: localSaveError === null,
        warning: localSaveError ? `Saved to the database only: ${localSaveError}` : undefined
      });
    } catch (dbError) {
      if (localSaveError) {
        return NextResponse.json(
          {
            error: `Failed to save settings. Database error: ${toErrorMessage(
              dbError,
              "Unknown database error."
            )}. Local fallback error: ${localSaveError}`
          },
          { status: 500 }
        );
      }

      const fallback = await prisma.business.findUnique({ where: { id: businessId }, include: { taxConfig: true } });
      const merged = mergeBusinessWithLocalSettings(fallback ?? { id: businessId } as never, localPayload);
      return NextResponse.json({
        ...merged,
        savedLocally: true,
        warning:
          dbError instanceof Error
            ? `Saved locally only: ${dbError.message}`
            : "Saved locally only: database update failed."
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: toErrorMessage(error, "Failed to save settings.")
      },
      { status: 500 }
    );
  }
}
