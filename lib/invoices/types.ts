export const InvoiceVatModes = {
  NO_VAT: "NO_VAT",
  INCLUSIVE: "INCLUSIVE",
  EXCLUSIVE: "EXCLUSIVE"
} as const;

export type InvoiceVatMode = (typeof InvoiceVatModes)[keyof typeof InvoiceVatModes];

export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatMode: InvoiceVatMode;
  vatRate: number;
  /** ROT/RUT invoices only: this line is qualifying labour. */
  rotRutLabour?: boolean;
  /** On a labour line the type of work; on a material line the type of work it belongs to; empty for other costs. */
  rotRutWorkType?: string | null;
  /** Hours worked, on a labour line. */
  rotRutHours?: number | null;
};

export type InvoiceItemComputed = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatMode: InvoiceVatMode;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
};
