/**
 * Payment reminders: when one may be sent automatically, and what it says.
 * Pure functions, shared by the cron job, the manual "Send reminder" action
 * and the settings preview.
 *
 * Legal background for the wording (Sweden):
 * - A reminder fee (at most 60 kr) may only be charged when it was agreed no
 *   later than when the debt arose: lag (1981:739) om ersättning för
 *   inkassokostnader m.m., 2 § and 4 §. Nothing is added automatically here.
 * - Late interest needs no agreement: räntelagen (1975:635) 3 § (from the due
 *   date when it was fixed in advance), 4 § (otherwise from 30 days after an
 *   invoice that says interest will be charged), 6 § (reference rate plus
 *   eight percentage points). The reminder only mentions the right; it does
 *   not calculate or add interest.
 */

import { daysBetween } from "@/lib/invoices/dates";

export const MAX_AUTOMATIC_REMINDERS = 3;
export const MIN_DAYS_BETWEEN_REMINDERS = 7;

export type ReminderEligibilityInput = {
  status: string;
  remaining: number;
  dueDate: Date | null;
  sentAt: Date | null;
  recipientEmail: string | null;
  reminderCount: number;
  lastReminderAt: Date | null;
  today: Date;
  /** Business setting: days after the due date before the first reminder. */
  daysAfterDue: number;
};

export type ReminderDecision =
  | { due: true }
  | {
      due: false;
      reason: "settled" | "no_due_date" | "not_sent" | "no_email" | "not_overdue_enough" | "max_reached" | "too_soon";
    };

export const reminderDecision = (input: ReminderEligibilityInput): ReminderDecision => {
  if (input.status === "PAID" || input.status === "VOID" || input.remaining <= 0.004) {
    return { due: false, reason: "settled" };
  }
  if (!input.dueDate) return { due: false, reason: "no_due_date" };
  if (!input.sentAt) return { due: false, reason: "not_sent" };
  if (!input.recipientEmail?.trim()) return { due: false, reason: "no_email" };
  if (daysBetween(input.dueDate, input.today) < Math.max(1, input.daysAfterDue)) {
    return { due: false, reason: "not_overdue_enough" };
  }
  if (input.reminderCount >= MAX_AUTOMATIC_REMINDERS) return { due: false, reason: "max_reached" };
  if (input.lastReminderAt && daysBetween(input.lastReminderAt, input.today) < MIN_DAYS_BETWEEN_REMINDERS) {
    return { due: false, reason: "too_soon" };
  }
  return { due: true };
};

export const isReminderDue = (input: ReminderEligibilityInput) => reminderDecision(input).due;

export type ReminderMessageInput = {
  locale: "sv" | "en";
  senderName: string;
  customerName: string;
  invoiceNumber: string;
  /** Already formatted, e.g. "12 500,00 kr". */
  amount: string;
  /** YYYY-MM-DD */
  dueDate: string;
  daysOverdue: number;
  /** 1 for the first reminder. */
  reminderNumber: number;
  paymentLines: { label: string; value: string }[];
  ocrReference?: string | null;
};

export const buildReminderMessage = (input: ReminderMessageInput): { subject: string; body: string } => {
  const sv = input.locale === "sv";
  const first = input.reminderNumber <= 1;
  const reference = input.ocrReference?.trim()
    ? `${sv ? "OCR-nummer" : "OCR reference"}: ${input.ocrReference.trim()}`
    : `${sv ? "Ange fakturanummer" : "Please quote invoice number"}: ${input.invoiceNumber}`;
  const payment = [...input.paymentLines.map((line) => `${line.label}: ${line.value}`), reference].join("\n");

  if (sv) {
    const subject = first
      ? `Påminnelse: faktura ${input.invoiceNumber} från ${input.senderName}`
      : `Påminnelse ${input.reminderNumber}: faktura ${input.invoiceNumber} från ${input.senderName}`;
    const body = [
      `Hej ${input.customerName},`,
      first
        ? `Vi vill vänligt påminna om att faktura ${input.invoiceNumber} förföll till betalning ${input.dueDate}. Vi har ännu inte kunnat se någon betalning.`
        : `Vi saknar fortfarande betalning för faktura ${input.invoiceNumber}, som förföll ${input.dueDate} (${input.daysOverdue} dagar sedan).`,
      `Att betala: ${input.amount}`,
      payment,
      "Fakturan finns bifogad som PDF. Har du redan betalat kan du bortse från det här meddelandet. Hör gärna av dig om något är oklart eller om du vill komma överens om en annan betalningsdag.",
      `Vänliga hälsningar\n${input.senderName}`
    ];
    return { subject, body: body.join("\n\n") };
  }

  const subject = first
    ? `Reminder: invoice ${input.invoiceNumber} from ${input.senderName}`
    : `Reminder ${input.reminderNumber}: invoice ${input.invoiceNumber} from ${input.senderName}`;
  const body = [
    `Hello ${input.customerName},`,
    first
      ? `This is a friendly reminder that invoice ${input.invoiceNumber} was due on ${input.dueDate}. We have not yet seen your payment.`
      : `We are still missing payment for invoice ${input.invoiceNumber}, which was due on ${input.dueDate} (${input.daysOverdue} days ago).`,
    `Amount to pay: ${input.amount}`,
    payment,
    "The invoice is attached as a PDF. If you have already paid, please disregard this message. Do get in touch if anything is unclear or if you would like to agree on another payment date.",
    `Kind regards\n${input.senderName}`
  ];
  return { subject, body: body.join("\n\n") };
};

/** Plain-language summary of what Swedish law allows, shown next to the reminder settings. */
export const reminderLawNote = (locale: "sv" | "en") =>
  locale === "sv"
    ? [
        "Akunta lägger aldrig på avgifter eller ränta automatiskt.",
        "Påminnelseavgift (högst 60 kr) får du bara ta ut om ni har avtalat om den senast när skulden uppkom, till exempel i offerten eller i dina villkor. Att bara skriva den på påminnelsen räcker inte.",
        "Dröjsmålsränta kan du kräva även utan avtal enligt räntelagen: referensräntan plus åtta procentenheter, från förfallodagen om den var avtalad i förväg, annars från 30 dagar efter att du skickat en faktura där det står att ränta tas ut. Därför står den upplysningen på dina fakturor.",
        "Är kunden ett företag har du dessutom rätt till 450 kr i förseningsersättning när dröjsmålsränta får tas ut."
      ]
    : [
        "Akunta never adds fees or interest automatically.",
        "A reminder fee (at most SEK 60) may only be charged if you agreed on it no later than when the debt arose, for example in the quote or in your terms. Writing it on the reminder is not enough.",
        "Late interest can be claimed without an agreement under the Swedish Interest Act: the reference rate plus eight percentage points, from the due date if it was agreed in advance, otherwise from 30 days after you sent an invoice stating that interest will be charged. That is why your invoices carry that notice.",
        "If the customer is a business you are also entitled to SEK 450 in late payment compensation once late interest may be charged."
      ];
