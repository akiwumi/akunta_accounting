import { AccountTypes, type AccountType } from "@/lib/domain/enums";

export type AccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  vatCode?: string;
  isSystem?: boolean;
};

export const swedishSoleTraderDefaultAccounts: AccountSeed[] = [
  { code: "1910", name: "Cash", type: AccountTypes.ASSET, isSystem: true },
  { code: "1930", name: "Business Bank Account", type: AccountTypes.ASSET, isSystem: true },
  { code: "2010", name: "Owner Equity", type: AccountTypes.EQUITY, isSystem: true },
  { code: "2610", name: "Output VAT 25%", type: AccountTypes.LIABILITY, vatCode: "OUT_25", isSystem: true },
  { code: "2641", name: "Input VAT", type: AccountTypes.ASSET, vatCode: "IN_STANDARD", isSystem: true },
  { code: "3001", name: "Sales 25% VAT", type: AccountTypes.INCOME, vatCode: "OUT_25", isSystem: true },
  { code: "3041", name: "Sales 12% VAT", type: AccountTypes.INCOME, vatCode: "OUT_12", isSystem: true },
  { code: "3046", name: "Sales 6% VAT", type: AccountTypes.INCOME, vatCode: "OUT_06", isSystem: true },
  { code: "4000", name: "Cost of Goods", type: AccountTypes.EXPENSE, isSystem: true },
  { code: "5410", name: "Consumables", type: AccountTypes.EXPENSE, isSystem: true },
  { code: "6110", name: "Office Supplies", type: AccountTypes.EXPENSE, isSystem: true },
  { code: "6530", name: "Accounting Services", type: AccountTypes.EXPENSE, isSystem: true },
  { code: "6570", name: "Bank Fees", type: AccountTypes.EXPENSE, isSystem: true }
];
