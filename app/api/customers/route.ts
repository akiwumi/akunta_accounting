import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { customerDataFrom, customerFieldsSchema, customerSelect } from "@/lib/invoices/customers";
import { authOrNull, jsonError, unauthorized, zodMessage } from "@/lib/invoices/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 20;

  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } }
            ]
          }
        : {})
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: customerSelect
  });

  return NextResponse.json({ customers });
}

/** Creates a customer. A customer with the same email already in the register is updated instead of duplicated. */
export async function POST(request: Request) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;

  const parsed = customerFieldsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);
  const data = customerDataFrom(parsed.data);

  const existing = data.email
    ? await prisma.customer.findFirst({ where: { businessId, email: data.email }, select: { id: true } })
    : null;

  const customer = existing
    ? await prisma.customer.update({ where: { id: existing.id }, data, select: customerSelect })
    : await prisma.customer.create({ data: { businessId, ...data }, select: customerSelect });

  return NextResponse.json({ customer, updatedExisting: Boolean(existing) });
}
