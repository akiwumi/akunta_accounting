import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { getBusinessTaxProfile } from "@/lib/tax/profileLoader";
import { listCountryProfiles } from "@/lib/tax/profiles";

export const dynamic = "force-dynamic";

/**
 * GET /api/tax/profiles
 *
 * Returns:
 *   - `templates`: all available country profile templates (28 total)
 *   - `activeProfile`: the business's current applied CountryTaxProfile (or null)
 */
export async function GET() {
  try {
    const { businessId } = await requireAuthContext();

    const [templates, activeProfile] = await Promise.all([
      Promise.resolve(listCountryProfiles()),
      getBusinessTaxProfile(businessId)
    ]);

    return NextResponse.json({ templates, activeProfile });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load tax profiles." }, { status: 500 });
  }
}
