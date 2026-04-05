import { TransactionDirections, type TransactionDirection } from "@/lib/domain/enums";

type ReceiptCategory = "sales" | "office" | "consumables" | "bank_fee" | "accounting" | "other";

export const normalizeReceiptCategory = (value?: string | null): ReceiptCategory => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("sale") || normalized.includes("income")) return "sales";
  if (normalized.includes("consum")) return "consumables";
  if (normalized.includes("bank")) return "bank_fee";
  if (normalized.includes("account")) return "accounting";
  if (normalized.includes("office")) return "office";
  return "other";
};

export const accountCodeForCategory = (category: ReceiptCategory, direction: TransactionDirection): string => {
  if (direction === TransactionDirections.INCOME) {
    return "3001";
  }

  switch (category) {
    case "consumables":
      return "5410";
    case "bank_fee":
      return "6570";
    case "accounting":
      return "6530";
    case "office":
      return "6110";
    default:
      return "4000";
  }
};

export const inferDirectionFromCategory = (category: ReceiptCategory): TransactionDirection => {
  if (category === "sales") return TransactionDirections.INCOME;
  return TransactionDirections.EXPENSE;
};
