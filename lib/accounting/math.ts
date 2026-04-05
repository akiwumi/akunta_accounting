export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const asNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);

  if (typeof value === "object" && value !== null) {
    if ("toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
      return (value as { toNumber: () => number }).toNumber();
    }
    if ("toString" in value && typeof (value as { toString: unknown }).toString === "function") {
      return Number((value as { toString: () => string }).toString());
    }
  }

  return Number(value);
};

export const safeDivide = (a: number, b: number): number => {
  if (b === 0) return 0;
  return a / b;
};
