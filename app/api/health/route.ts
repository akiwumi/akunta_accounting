import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Returns 200 when the app and DB are reachable.
 * Returns 503 if the DB ping fails.
 *
 * Used by uptime monitors, load balancers, and deployment readiness checks.
 * Does NOT require authentication — keep it public.
 */
export async function GET() {
  const started = Date.now();

  let dbOk = false;
  let dbError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "unknown db error";
  }

  const latencyMs = Date.now() - started;
  const status = dbOk ? 200 : 503;

  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? "ok" : "error",
      ...(dbError ? { dbError } : {}),
      latencyMs,
      ts: new Date().toISOString()
    },
    { status }
  );
}
