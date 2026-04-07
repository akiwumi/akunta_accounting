import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext, writeAuditLog } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { applyCountryTemplate } from "@/lib/tax/profileLoader";
import { resolveCountry } from "@/lib/tax/countryResolver";
import { logger } from "@/lib/observability/logger";

const confirmSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  /** If true, apply the country template immediately after confirming */
  applyTemplate: z.boolean().default(true)
});

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding/country
 *
 * Returns the resolved country for the authenticated business.
 * Infers from Accept-Language if no country is persisted yet.
 */
export async function GET(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        countryCode: true,
        countryResolutionSource: true,
        lastCountryConfirmedAt: true,
        taxProfileTemplateVersion: true,
        jurisdiction: true
      }
    });

    const acceptLanguage = request.headers.get("accept-language");
    const resolution = resolveCountry({
      persistedCountryCode: business?.countryCode,
      acceptLanguage
    });

    return NextResponse.json({
      resolved: resolution,
      persisted: {
        countryCode: business?.countryCode ?? null,
        source: business?.countryResolutionSource ?? null,
        confirmedAt: business?.lastCountryConfirmedAt ?? null,
        templateVersion: business?.taxProfileTemplateVersion ?? null
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to resolve country." }, { status: 500 });
  }
}

/**
 * POST /api/onboarding/country
 * Body: { countryCode: "GB", applyTemplate: true }
 *
 * Persists the country selection (explicit user confirmation) and optionally
 * applies the country tax template.
 */
export async function POST(request: Request) {
  try {
    const { businessId, userId } = await requireAuthContext();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? "Validation error." },
        { status: 422 }
      );
    }

    const { countryCode, applyTemplate } = parsed.data;

    // Persist country resolution metadata
    await prisma.business.update({
      where: { id: businessId },
      data: {
        countryCode,
        countryResolutionSource: "onboarding",
        lastCountryConfirmedAt: new Date()
      }
    });

    let templateResult: { ok: boolean; profileId?: string; error?: string } | null = null;
    if (applyTemplate) {
      templateResult = await applyCountryTemplate(businessId, countryCode);
      if (!templateResult.ok) {
        logger.warn("onboarding.country.template_not_found", { businessId, countryCode });
        // Not a fatal error — country is still persisted
      }
    }

    await writeAuditLog(
      businessId,
      userId,
      "Business",
      businessId,
      "CONFIRM_COUNTRY",
      null,
      { countryCode, applyTemplate, templateApplied: templateResult?.ok ?? false }
    );

    logger.info("onboarding.country.confirmed", {
      businessId,
      countryCode,
      templateApplied: templateResult?.ok ?? false
    });

    return NextResponse.json({
      ok: true,
      countryCode,
      templateApplied: templateResult?.ok ?? false,
      templateError: templateResult?.ok === false ? templateResult.error : undefined
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to confirm country." }, { status: 500 });
  }
}
