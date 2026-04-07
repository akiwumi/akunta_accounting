/**
 * GET  /api/integrations/skatteverket/id1?year=2024
 *   Returns the ID1 draft for the given tax year. Saves a Filing record on first call.
 *
 * POST /api/integrations/skatteverket/id1
 *   Body: { year: number }
 *   Re-computes and updates the ID1 draft. Returns the updated draft.
 *
 * The draft is informational — the user must verify the figures before filing
 * via Skatteverkets Mina Sidor or e-tjänst. Direct electronic submission via
 * the Skatteverket API will be added when the API becomes generally available.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prepareId1Draft } from "@/lib/integrations/skatteverket/inkomstdeklaration1";
import { prisma } from "@/lib/db";

const currentYear = new Date().getFullYear();
const yearSchema  = z.number().int().min(2015).max(currentYear);

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { businessId } = await requireAuthContext();

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  // Default to prior calendar year (the tax year normally being declared now)
  const year = yearParam ? parseInt(yearParam, 10) : currentYear - 1;

  const parsed = yearSchema.safeParse(year);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `year must be between 2015 and ${currentYear}.` },
      { status: 400 }
    );
  }

  // Try to load existing draft first to avoid recomputing unnecessarily
  const yearStart = new Date(Date.UTC(parsed.data, 0, 1));
  const yearEnd   = new Date(Date.UTC(parsed.data, 11, 31, 23, 59, 59, 999));

  const existing = await prisma.filing.findFirst({
    where: {
      businessId,
      filingType: "ID1",
      periodStart: yearStart,
      periodEnd:   yearEnd,
    },
  });

  if (existing?.payloadJson && existing.status === "DRAFT") {
    try {
      const cached = JSON.parse(existing.payloadJson);
      return NextResponse.json({ ...cached, filingId: existing.id, cached: true });
    } catch {
      // malformed payload — recompute
    }
  }

  try {
    const draft = await prepareId1Draft(businessId, parsed.data, true);
    return NextResponse.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare ID1 draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { businessId } = await requireAuthContext();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = z.object({ year: yearSchema }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Validation error." },
      { status: 422 }
    );
  }

  try {
    // Force recompute and save
    const draft = await prepareId1Draft(businessId, parsed.data.year, true);
    return NextResponse.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare ID1 draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
