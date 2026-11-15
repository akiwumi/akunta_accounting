import { NextResponse } from "next/server";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { generateReceiptInboxToken, isReceiptInboxConfigured, receiptInboxAddress } from "@/lib/receipts/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates the receipt inbox address, or replaces it: the old address stops working at once. */
export async function POST() {
  const { businessId, userId } = await requireAuthContext();
  if (!isReceiptInboxConfigured()) {
    return NextResponse.json({ error: "Receipt email is not set up on this server." }, { status: 503 });
  }

  const token = generateReceiptInboxToken();
  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: businessId }, data: { receiptInboxToken: token } });
    await writeLedgerAudit(tx, {
      businessId,
      userId,
      entityType: "Business",
      entityId: businessId,
      action: "RECEIPT_INBOX_ROTATED"
    });
  });

  return NextResponse.json({ address: receiptInboxAddress(token) });
}

/** Switches the receipt inbox off. */
export async function DELETE() {
  const { businessId, userId } = await requireAuthContext();
  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: businessId }, data: { receiptInboxToken: null } });
    await writeLedgerAudit(tx, {
      businessId,
      userId,
      entityType: "Business",
      entityId: businessId,
      action: "RECEIPT_INBOX_DISABLED"
    });
  });

  return NextResponse.json({ address: null });
}
