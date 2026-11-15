import { prisma } from "@/lib/db";
import { parseTaxYear } from "@/lib/data/period";
import { swedishToday } from "@/lib/tax/vat-periods";

/**
 * The fiscal years (calendar years) that can be shown: from the first booked
 * entry to this year, newest first, and the one the request asks for.
 */
export const resolveAccountYear = async (businessId: string, requested: string | undefined) => {
  const currentYear = Number(swedishToday().slice(0, 4));
  const range = await prisma.transaction.aggregate({
    where: { businessId },
    _min: { txnDate: true },
    _max: { txnDate: true }
  });
  const first = Math.min(range._min.txnDate?.getUTCFullYear() ?? currentYear, currentYear);
  const last = Math.max(range._max.txnDate?.getUTCFullYear() ?? currentYear, currentYear);
  const years: number[] = [];
  for (let year = last; year >= first && years.length < 30; year -= 1) years.push(year);

  const wanted = parseTaxYear(requested);
  const year = wanted !== null && years.includes(wanted) ? wanted : currentYear;
  return { year, years };
};
