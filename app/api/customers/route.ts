import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(120).optional(),
  addressLine1: z.string().trim().max(180).optional(),
  addressLine2: z.string().trim().max(180).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional()
});

export async function GET(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

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
              { name: { contains: query } },
              { email: { contains: query } },
              { phone: { contains: query } }
            ]
          }
        : {})
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      website: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postalCode: true,
      country: true,
      notes: true
    }
  });

  return NextResponse.json({ customers });
}

export async function POST(request: Request) {
  let businessId: string;
  try {
    ({ businessId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = customerSchema.parse(await request.json());
  const normalizedEmail = payload.email?.trim() || null;

  const existing =
    normalizedEmail &&
    (await prisma.customer.findFirst({
      where: {
        businessId,
        email: normalizedEmail
      },
      select: { id: true }
    }));

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: payload.name,
          email: normalizedEmail,
          phone: payload.phone?.trim() || null,
          website: payload.website?.trim() || null,
          addressLine1: payload.addressLine1?.trim() || null,
          addressLine2: payload.addressLine2?.trim() || null,
          city: payload.city?.trim() || null,
          postalCode: payload.postalCode?.trim() || null,
          country: payload.country?.trim() || null,
          notes: payload.notes?.trim() || null
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          website: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          country: true,
          notes: true
        }
      })
    : await prisma.customer.create({
        data: {
          businessId,
          name: payload.name,
          email: normalizedEmail,
          phone: payload.phone?.trim() || null,
          website: payload.website?.trim() || null,
          addressLine1: payload.addressLine1?.trim() || null,
          addressLine2: payload.addressLine2?.trim() || null,
          city: payload.city?.trim() || null,
          postalCode: payload.postalCode?.trim() || null,
          country: payload.country?.trim() || null,
          notes: payload.notes?.trim() || null
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          website: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          country: true,
          notes: true
        }
      });

  return NextResponse.json({ customer });
}
