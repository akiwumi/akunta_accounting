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
