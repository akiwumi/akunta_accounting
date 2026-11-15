/**
 * GET    /api/customers/[id]
 * PATCH  /api/customers/[id]   edit the customer
 * DELETE /api/customers/[id]   only when the customer has no invoices or quotes
 *
 * Invoices keep their own copy of the customer's name and address from the
 * day they were issued, so editing a customer never changes an old invoice.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { customerDataFrom, customerFieldsSchema, customerSelect } from "@/lib/invoices/customers";
import { authOrNull, jsonError, requestText, unauthorized, zodMessage } from "@/lib/invoices/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const customer = await prisma.customer.findFirst({
    where: { id: (await context.params).id, businessId: auth.businessId },
    select: customerSelect
  });
  if (!customer) return jsonError("Customer not found.", 404);
  return NextResponse.json({ customer });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();
  const id = (await context.params).id;

  const parsed = customerFieldsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);
  const data = customerDataFrom(parsed.data);

  const existing = await prisma.customer.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) return jsonError(t("Kunden hittades inte.", "Customer not found."), 404);

  if (data.email) {
    const clash = await prisma.customer.findFirst({
      where: { businessId, email: data.email, id: { not: id } },
      select: { name: true }
    });
    if (clash) {
      return jsonError(
        t(
          `E-postadressen används redan av kunden ${clash.name}.`,
          `That email address is already used by the customer ${clash.name}.`
        ),
        409
      );
    }
  }

  const customer = await prisma.customer.update({ where: { id }, data, select: customerSelect });
  // Recurring templates follow the customer, so the next invoice goes to the right place.
  await prisma.recurringInvoice.updateMany({
    where: { businessId, customerId: id },
    data: { customerName: customer.name, customerEmail: customer.email }
  });
  return NextResponse.json({ customer });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await authOrNull();
  if (!auth) return unauthorized();
  const { businessId } = auth;
  const t = await requestText();
  const id = (await context.params).id;

  const customer = await prisma.customer.findFirst({
    where: { id, businessId },
    select: { id: true, _count: { select: { invoices: true, quotes: true } } }
  });
  if (!customer) return jsonError(t("Kunden hittades inte.", "Customer not found."), 404);

  const { invoices, quotes } = customer._count;
  if (invoices > 0 || quotes > 0) {
    const sv = [invoices > 0 ? `${invoices} ${invoices === 1 ? "faktura" : "fakturor"}` : "", quotes > 0 ? `${quotes} ${quotes === 1 ? "offert" : "offerter"}` : ""]
      .filter(Boolean)
      .join(" och ");
    const en = [invoices > 0 ? `${invoices} ${invoices === 1 ? "invoice" : "invoices"}` : "", quotes > 0 ? `${quotes} ${quotes === 1 ? "quote" : "quotes"}` : ""]
      .filter(Boolean)
      .join(" and ");
    return jsonError(
      t(
        `Kunden har ${sv} och kan därför inte tas bort. Fakturor är räkenskapsmaterial som ska sparas i sju år, och kunden behövs för att de ska gå att hitta. Du kan ändra kundens uppgifter i stället.`,
        `This customer has ${en} and cannot be deleted. Invoices are accounting records that must be kept for seven years, and the customer is needed to find them. You can edit the customer's details instead.`
      ),
      409
    );
  }

  // Templates that only point at the customer are released, not removed.
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
