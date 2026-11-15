import { z } from "zod";

import { documentCustomerSchema } from "@/lib/invoices/customers";
import { InvoiceVatModes } from "@/lib/invoices/types";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const quoteInputSchema = z.object({
  customer: documentCustomerSchema,
  projectName: z.string().trim().max(180).optional(),
  description: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(2000).optional(),
  issueDate: isoDay,
  validUntil: isoDay.optional().or(z.literal("")),
  currency: z.enum(["SEK", "EUR", "GBP"]).default("SEK"),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(240),
        quantity: z.number().positive(),
        unitPrice: z.number().min(0),
        vatMode: z.enum([InvoiceVatModes.NO_VAT, InvoiceVatModes.INCLUSIVE, InvoiceVatModes.EXCLUSIVE]),
        vatRate: z.number().min(0).max(1).default(0)
      })
    )
    .min(1)
});

export type QuoteInput = z.infer<typeof quoteInputSchema>;
