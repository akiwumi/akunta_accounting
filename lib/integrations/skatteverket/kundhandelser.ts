/**
 * Kundändelser (Customer events) — Skatteverket event and deadline feed.
 *
 * Use for:
 *  - Showing upcoming tax deadlines on compliance page
 *  - Filing action notifications
 *  - Pending obligations
 */

import { skvRequest } from "./client";
import { prisma } from "@/lib/db";

export type KundhandelseEvent = {
  id: string;
  typ: string;
  titel: string;
  beskrivning?: string;
  handelsedatum?: string;
  forfallodatum?: string;
};

export type KundhandelserResponse = {
  organisationsnummer: string;
  handelser: KundhandelseEvent[];
};

/**
 * Fetch the event feed for an organisation.
 */
export const fetchKundhandelser = async (orgNumber: string): Promise<KundhandelserResponse> => {
  const clean = orgNumber.replace(/[-\s]/g, "");
  return skvRequest<KundhandelserResponse>({
    method: "GET",
    path: `/kundhandelser/v1/${encodeURIComponent(clean)}`
  });
};

/**
 * Sync events to the TaxEvent table for a business.
 * Upserts by eventRef to avoid duplicates.
 */
export const syncKundhandelserToDB = async (businessId: string, orgNumber: string): Promise<number> => {
  const response = await fetchKundhandelser(orgNumber);
  let synced = 0;

  for (const event of response.handelser) {
    const existing = await prisma.taxEvent.findFirst({
      where: { businessId, eventRef: event.id }
    });

    if (!existing) {
      await prisma.taxEvent.create({
        data: {
          businessId,
          source: "kundhandelser",
          eventType: event.typ,
          eventRef: event.id,
          title: event.titel,
          detail: event.beskrivning,
          eventDate: event.forfallodatum ? new Date(event.forfallodatum) : undefined
        }
      });
      synced++;
    }
  }

  return synced;
};
