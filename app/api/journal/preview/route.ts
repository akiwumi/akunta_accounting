import { NextResponse } from "next/server";
import { z } from "zod";

import { journalErrorResponse, unauthorized } from "@/app/api/journal/errors";
import { JOURNAL_TEMPLATE_IDS, previewTemplate } from "@/lib/accounting/journalTemplates";
import { requireAuthContext } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  template: z.enum(JOURNAL_TEMPLATE_IDS),
  input: z.record(z.string(), z.unknown())
});

/**
 * POST /api/journal/preview
 *
 * What a guided entry will book, with account names. Writes nothing.
 */
export async function POST(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return unauthorized();
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INPUT" }, { status: 422 });
  }

  try {
    return NextResponse.json(await previewTemplate({ businessId, ...parsed.data }));
  } catch (error) {
    return journalErrorResponse(error);
  }
}
