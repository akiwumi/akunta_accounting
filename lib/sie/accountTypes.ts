import { AccountTypes, type AccountType } from "@/lib/domain/enums";

/**
 * Account type for an account number in the BAS chart of accounts.
 *
 *   class 1          assets
 *   class 2          equity and liabilities. Equity is 2000-2099; everything
 *                    above (untaxed reserves, provisions, debts) is a liability,
 *                    which is how lib/accounting/chartOfAccounts.ts models it.
 *   class 3          income
 *   classes 4-7      expenses
 *   class 8          financial items: 8000-8399 income, 8400-8999 expenses
 *
 * Anything that does not start with 1-8 is treated as an expense, the least
 * harmful guess: it stays out of the balance sheet.
 */
export const accountTypeFromBas = (code: string): AccountType => {
  const number = Number(code.slice(0, 4).padEnd(4, "0"));
  if (number >= 1000 && number <= 1999) return AccountTypes.ASSET;
  if (number >= 2000 && number <= 2099) return AccountTypes.EQUITY;
  if (number >= 2100 && number <= 2999) return AccountTypes.LIABILITY;
  if (number >= 3000 && number <= 3999) return AccountTypes.INCOME;
  if (number >= 8000 && number <= 8399) return AccountTypes.INCOME;
  return AccountTypes.EXPENSE;
};

/**
 * #KTYP in a SIE file is T, S, K or I (tillgång, skuld, kostnad, intäkt).
 * SIE has no separate type for equity: it is an "S" account, so the BAS
 * number decides between equity and liability.
 */
export const accountTypeFromSie = (code: string, sieType: "T" | "S" | "K" | "I" | undefined): AccountType => {
  switch (sieType) {
    case "T":
      return AccountTypes.ASSET;
    case "S":
      return accountTypeFromBas(code) === AccountTypes.EQUITY ? AccountTypes.EQUITY : AccountTypes.LIABILITY;
    case "K":
      return AccountTypes.EXPENSE;
    case "I":
      return AccountTypes.INCOME;
    default:
      return accountTypeFromBas(code);
  }
};

export const sieTypeFromAccountType = (type: string): "T" | "S" | "K" | "I" => {
  if (type === AccountTypes.ASSET) return "T";
  if (type === AccountTypes.INCOME) return "I";
  if (type === AccountTypes.EXPENSE) return "K";
  return "S";
};

export const isBalanceSheetType = (type: string): boolean =>
  type === AccountTypes.ASSET || type === AccountTypes.LIABILITY || type === AccountTypes.EQUITY;

/**
 * Akunta stores balances with their natural sign (a liability of 500 is +500).
 * SIE writes every balance debit-positive (the same liability is -500).
 * The conversion is its own inverse.
 */
export const flipForAccountType = (type: string, ore: number): number =>
  type === AccountTypes.ASSET || type === AccountTypes.EXPENSE || ore === 0 ? ore : -ore;
