/**
 * In-memory rate limiter for Node.js API routes.
 * Uses a sliding window counter per (key, window).
 * Redis-compatible interface — swap the store for a Redis client when needed.
 *
 * Usage:
 *   const result = await rateLimit({ key: ip, limit: 10, windowSeconds: 60 });
 *   if (!result.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
 */

type WindowEntry = { count: number; resetAt: number };

// Global store — survives hot-reloads in dev via globalThis
const globalStore = globalThis as typeof globalThis & { __rlStore?: Map<string, WindowEntry> };
if (!globalStore.__rlStore) globalStore.__rlStore = new Map();
const store = globalStore.__rlStore;

// Prune expired entries every 5 minutes to prevent unbounded growth
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  },
  5 * 60 * 1000
);

export type RateLimitOptions = {
  /** Unique identifier — typically IP + route */
  key: string;
  /** Max requests allowed within the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

export function rateLimit({ key, limit, windowSeconds }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    // New window
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt: new Date(resetAt) };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: new Date(existing.resetAt)
  };
}

/**
 * Extract the real client IP from a Next.js/Vercel request.
 * Falls back to "unknown" so rate limiting still applies.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers as Headers;
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
