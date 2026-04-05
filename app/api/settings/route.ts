import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { Jurisdictions } from "@/lib/domain/enums";
import { sanitizeInvoiceNumberPattern } from "@/lib/invoices/numbering";

const updateSchema = z.object({
  name: z.string().min(2).max(120),
  jurisdiction: z.enum([Jurisdictions.SWEDEN, Jurisdictions.EU_GENERIC, Jurisdictions.UK]),
  locale: z.enum(["en", "sv"]).default("en"),
  baseCurrency: z.enum(["SEK", "EUR", "GBP"]).default("SEK"),
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
  municipalTaxRate: z.number().min(0).max(1),
  socialContributionRate: z.number().min(0).max(1),
  generalDeductionRate: z.number().min(0).max(1)
});

export const dynamic = "force-dynamic";

export async function GET() {
  const business = await ensureBusiness();
  const fullBusiness = await prisma.business.findUnique({
    where: { id: business.id },
    include: { taxConfig: true }
  });

  return NextResponse.json(fullBusiness);
}

export async function PUT(request: Request) {
  const business = await ensureBusiness();
  const body = await request.json();
  const payload = updateSchema.parse(body);

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: {
      name: payload.name,
      jurisdiction: payload.jurisdiction,
      locale: payload.locale,
      baseCurrency: payload.baseCurrency,
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

  return NextResponse.json(updated);
}
