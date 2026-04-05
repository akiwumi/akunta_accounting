export const Jurisdictions = {
  SWEDEN: "SWEDEN",
  EU_GENERIC: "EU_GENERIC",
  UK: "UK"
} as const;

export type Jurisdiction = (typeof Jurisdictions)[keyof typeof Jurisdictions];

export const AccountTypes = {
  ASSET: "ASSET",
  LIABILITY: "LIABILITY",
  EQUITY: "EQUITY",
  INCOME: "INCOME",
  EXPENSE: "EXPENSE"
} as const;

export type AccountType = (typeof AccountTypes)[keyof typeof AccountTypes];

export const EntrySources = {
  RECEIPT: "RECEIPT",
  BANK_IMPORT: "BANK_IMPORT",
  MANUAL: "MANUAL",
  EMAIL: "EMAIL",
  INVOICE_PAYMENT: "INVOICE_PAYMENT"
} as const;

export type EntrySource = (typeof EntrySources)[keyof typeof EntrySources];

export const TransactionDirections = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER"
} as const;

export type TransactionDirection = (typeof TransactionDirections)[keyof typeof TransactionDirections];
