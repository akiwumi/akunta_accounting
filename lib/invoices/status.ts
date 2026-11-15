/**
 * Invoice status the way a person thinks about it, computed from the due date
 * and what has been paid or credited. The stored Invoice.status column
 * (UNPAID | PARTIAL | PAID | VOID) is only one of the inputs.
 */

import { round2 } from "@/lib/accounting/math";
import { daysBetween } from "@/lib/invoices/dates";

export type InvoiceStatusKind =
  | "DRAFT"
  | "SENT"
  | "DUE"
  | "OVERDUE"
  | "PARTLY_PAID"
  | "PAID"
  | "CREDITED"
  | "VOID";

export type InvoiceStatusInput = {
  status: string;
  grossAmount: number;
  paidAmount: number;
  creditedAmount: number;
  /** ROT/RUT: the part Skatteverket pays, which the customer never owes. */
  skatteverketAmount?: number;
  dueDate: Date | null;
  sentAt: Date | null;
  today: Date;
};

export type InvoiceStatus = {
  kind: InvoiceStatusKind;
  /** What the customer still owes. Never negative. */
  remaining: number;
  /** Days until the due date (DUE) or days past it (OVERDUE and overdue PARTLY_PAID). */
  days: number;
  /** True when money is owed and the due date has passed. */
  overdue: boolean;
};

const CENT = 0.005;

export const invoiceRemaining = (grossAmount: number, paidAmount: number, creditedAmount: number, skatteverketAmount = 0) =>
  Math.max(0, round2(grossAmount - skatteverketAmount - paidAmount - creditedAmount));

export const computeInvoiceStatus = (input: InvoiceStatusInput): InvoiceStatus => {
  const remaining = invoiceRemaining(
    input.grossAmount,
    input.paidAmount,
    input.creditedAmount,
    input.skatteverketAmount ?? 0
  );

  if (input.status === "VOID") return { kind: "VOID", remaining: 0, days: 0, overdue: false };

  if (remaining < CENT) {
    const fullyCredited = input.creditedAmount > 0 && input.creditedAmount >= input.grossAmount - CENT;
    return { kind: fullyCredited ? "CREDITED" : "PAID", remaining: 0, days: 0, overdue: false };
  }

  const daysToDue = input.dueDate ? daysBetween(input.today, input.dueDate) : null;
  const overdue = daysToDue !== null && daysToDue < 0;

  if (input.paidAmount > 0 || input.creditedAmount > 0 || input.status === "PARTIAL") {
    return { kind: "PARTLY_PAID", remaining, days: overdue ? -daysToDue : 0, overdue };
  }

  // Not sent yet: nobody has been asked to pay, so it cannot be late.
  if (!input.sentAt) return { kind: "DRAFT", remaining, days: 0, overdue: false };

  if (daysToDue === null) return { kind: "SENT", remaining, days: 0, overdue: false };
  if (overdue) return { kind: "OVERDUE", remaining, days: -daysToDue, overdue: true };
  return { kind: "DUE", remaining, days: daysToDue, overdue: false };
};

export const invoiceStatusLabel = (status: InvoiceStatus, locale: "sv" | "en"): string => {
  const sv = locale === "sv";
  const dayWord = (n: number) => (sv ? (n === 1 ? "dag" : "dagar") : n === 1 ? "day" : "days");
  switch (status.kind) {
    case "DRAFT":
      return sv ? "Utkast, ej skickad" : "Draft, not sent";
    case "SENT":
      return sv ? "Skickad" : "Sent";
    case "DUE":
      if (status.days === 0) return sv ? "Förfaller i dag" : "Due today";
      return sv ? `Förfaller om ${status.days} ${dayWord(status.days)}` : `Due in ${status.days} ${dayWord(status.days)}`;
    case "OVERDUE":
      return sv
        ? `Försenad ${status.days} ${dayWord(status.days)}`
        : `Overdue ${status.days} ${dayWord(status.days)}`;
    case "PARTLY_PAID":
      if (status.overdue) {
        return sv
          ? `Delbetald, försenad ${status.days} ${dayWord(status.days)}`
          : `Partly paid, overdue ${status.days} ${dayWord(status.days)}`;
      }
      return sv ? "Delbetald" : "Partly paid";
    case "PAID":
      return sv ? "Betald" : "Paid";
    case "CREDITED":
      return sv ? "Krediterad" : "Credited";
    case "VOID":
      return sv ? "Makulerad" : "Void";
  }
};

/** Badge tone: good (settled), warn (needs attention) or neutral. */
export const invoiceStatusTone = (status: InvoiceStatus): "good" | "warn" | "" => {
  if (status.kind === "PAID" || status.kind === "CREDITED") return "good";
  if (status.overdue) return "warn";
  return "";
};
