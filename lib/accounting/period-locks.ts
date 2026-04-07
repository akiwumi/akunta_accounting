import { prisma } from "@/lib/db";

/**
 * Returns true if the given date falls inside a locked period for the business.
 */
export const isDateInLockedPeriod = async (businessId: string, date: Date): Promise<boolean> => {
  const lock = await prisma.periodLock.findFirst({
    where: {
      businessId,
      periodStart: { lte: date },
      periodEnd: { gte: date }
    }
  });
  return lock !== null;
};

/**
 * Throws if the date falls in a locked period.
 */
export const assertNotLockedPeriod = async (businessId: string, date: Date): Promise<void> => {
  const locked = await isDateInLockedPeriod(businessId, date);
  if (locked) {
    throw new Error(
      `The date ${date.toISOString().slice(0, 10)} falls within a locked accounting period. Unlock the period before posting.`
    );
  }
};

export const lockPeriod = async (businessId: string, periodStart: Date, periodEnd: Date, userId?: string) => {
  return prisma.periodLock.create({
    data: { businessId, periodStart, periodEnd, lockedByUserId: userId }
  });
};

export const unlockPeriod = async (businessId: string, periodLockId: string) => {
  return prisma.periodLock.delete({
    where: { id: periodLockId, businessId }
  });
};

export const getLockedPeriods = async (businessId: string) => {
  return prisma.periodLock.findMany({
    where: { businessId },
    orderBy: { periodStart: "desc" }
  });
};
