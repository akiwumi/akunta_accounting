import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/auth/context";
import { applyCountryTemplate, getBusinessTaxProfile } from "@/lib/tax/profileLoader";
import { logger } from "@/lib/observability/logger";

const applySchema = z.object({
  countryCode: z.string().length(2).toUpperCase()
});

export const dynamic = "force-dynamic";

/**
 * POST /api/tax/profiles/apply
 * Body: { countryCode: "DE" }
 *
 * Applies the named country template to the authenticated business.
 * Idempotent: re-applying replaces the previous profile.
 * Writes an audit log entry.
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

    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? "Validation error." },
        { status: 422 }
      );
    }

    const { countryCode } = parsed.data;
    const result = await applyCountryTemplate(businessId, countryCode);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const profile = await getBusinessTaxProfile(businessId);

    await writeAuditLog(businessId, userId, "CountryTaxProfile", result.profileId!, "APPLY_TEMPLATE", null, { countryCode });
    logger.info("tax.profile.applied", { businessId, countryCode });

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to apply tax profile." }, { status: 500 });
  }
}
