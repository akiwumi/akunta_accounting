/**
 * Customer details as they arrive from the invoice and quote forms, and the
 * rule for which customer record they belong to: the chosen one, else one
 * with the same email, else one with the same name, else a new one. Details
 * typed on a document are remembered on the customer.
 */

import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { joinAddress } from "@/lib/invoices/create";

export const documentCustomerSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(120).optional(),
  addressLine1: z.string().trim().max(180).optional(),
  addressLine2: z.string().trim().max(180).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional()
});

export type DocumentCustomer = z.infer<typeof documentCustomerSchema>;

export const upsertDocumentCustomer = async (
  db: Prisma.TransactionClient,
  businessId: string,
  payload: DocumentCustomer
) => {
  const email = payload.email?.trim() || null;
  const name = payload.name.trim();

  const existing = payload.id
    ? await db.customer.findFirst({ where: { id: payload.id, businessId }, select: { id: true } })
    : email
      ? await db.customer.findFirst({ where: { businessId, email }, select: { id: true } })
      : await db.customer.findFirst({ where: { businessId, name }, select: { id: true } });

  const data = {
    name,
    email,
    phone: payload.phone?.trim() || null,
    website: payload.website?.trim() || null,
    addressLine1: payload.addressLine1?.trim() || null,
    addressLine2: payload.addressLine2?.trim() || null,
    city: payload.city?.trim() || null,
    postalCode: payload.postalCode?.trim() || null,
    country: payload.country?.trim() || null
  };

  const customer = existing
    ? await db.customer.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.customer.create({ data: { businessId, ...data }, select: { id: true } });

  return {
    id: customer.id,
    ...data,
    address: joinAddress([data.addressLine1, data.addressLine2, data.postalCode, data.city, data.country]) || null
  };
};

/** Stored customer fields, as accepted by the customer register. */
export const customerFieldsSchema = z.object({
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

export const customerDataFrom = (payload: z.infer<typeof customerFieldsSchema>) => ({
  name: payload.name,
  email: payload.email?.trim() || null,
  phone: payload.phone?.trim() || null,
  website: payload.website?.trim() || null,
  addressLine1: payload.addressLine1?.trim() || null,
  addressLine2: payload.addressLine2?.trim() || null,
  city: payload.city?.trim() || null,
  postalCode: payload.postalCode?.trim() || null,
  country: payload.country?.trim() || null,
  notes: payload.notes?.trim() || null
});

export const customerSelect = {
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
} satisfies Prisma.CustomerSelect;
