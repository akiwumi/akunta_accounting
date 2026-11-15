import { NextResponse } from "next/server";
import { z } from "zod";

import { AccountError, updateAccount } from "@/lib/accounting/accounts";
import { requireAuthContext } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().max(200).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: "Nothing to change."
  });

/**
 * PATCH /api/accounts/:id
 *
 * Rename an account, or deactivate or reactivate it. There is no DELETE: an
 * account is never removed, only hidden from pickers.
 */
export async function PATCH(request: Request, context: RouteContext) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = (await context.params).id;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INPUT" }, { status: 422 });
  }

  try {
    const account = await updateAccount({ businessId, userId, accountId, ...parsed.data });
    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof AccountError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[accounts]", error);
    return NextResponse.json({ error: "The account could not be changed." }, { status: 500 });
  }
}
