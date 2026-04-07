/**
 * Cleanup expired sessions from the database.
 *
 * Run periodically via cron or a scheduled job:
 *   npx tsx scripts/cleanup-sessions.ts
 *
 * Recommended schedule: daily.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: now } }
  });
  console.log(`[cleanup-sessions] Deleted ${result.count} expired session(s) as of ${now.toISOString()}`);
}

main()
  .catch((err) => {
    console.error("[cleanup-sessions] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
