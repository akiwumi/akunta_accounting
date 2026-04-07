import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit-logs?page=1&pageSize=50&entityType=Receipt
 *
 * Returns paginated audit log entries for the authenticated business.
 * Optional filters: entityType, entityId, action.
 */
export async function GET(request: Request) {
  try {
    const { businessId } = await requireAuthContext();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const entityType = searchParams.get("entityType") ?? undefined;
    const entityId = searchParams.get("entityId") ?? undefined;
    const action = searchParams.get("action") ?? undefined;

    const where = {
      businessId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(action ? { action } : {})
    };

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          action: true,
          userId: true,
          createdAt: true,
          beforeJson: true,
          afterJson: true
        }
      })
    ]);

    return NextResponse.json({
      entries,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load audit logs." }, { status: 500 });
  }
}
