/**
 * Receipt inbox: each business gets a private address it can forward receipts
 * to. The secret token in the address is the only thing that identifies the
 * business to the inbound email webhook (app/api/receipts/email-webhook).
 *
 *   receipts+<token>@<RECEIPT_INBOX_DOMAIN>
 *
 * The inbound mail provider must deliver that domain to the webhook and send
 * the EMAIL_WEBHOOK_SECRET header.
 */

import { randomBytes } from "crypto";

/** 24 URL-safe characters (144 bits). Matches the pattern the webhook parses. */
export const generateReceiptInboxToken = () => randomBytes(18).toString("base64url");

/** Null when no inbound domain is configured, or the business has no token. */
export const receiptInboxAddress = (token: string | null | undefined): string | null => {
  const domain = process.env.RECEIPT_INBOX_DOMAIN?.trim();
  if (!domain || !token) return null;
  const localPart = process.env.RECEIPT_INBOX_LOCALPART?.trim() || "receipts";
  return `${localPart}+${token}@${domain}`;
};

export const isReceiptInboxConfigured = () => Boolean(process.env.RECEIPT_INBOX_DOMAIN?.trim());
