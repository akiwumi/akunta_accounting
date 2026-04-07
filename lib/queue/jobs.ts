/**
 * Queue job definitions and enqueue helpers.
 *
 * Uses Upstash QStash to publish jobs. When QSTASH_TOKEN is not set (local
 * development), jobs are executed synchronously inline via SYNC_QUEUE_IN_DEV.
 *
 * Env vars:
 *   QSTASH_TOKEN             — required in production
 *   NEXT_PUBLIC_APP_URL      — base URL QStash will POST back to
 *   QSTASH_DELAY_SECONDS     — optional: delay before delivery (default 0)
 */

// ─── Job payloads ─────────────────────────────────────────────────────────────

export interface OcrJobPayload {
  type: "ocr";
  receiptId: string;
  businessId: string;
}

export type JobPayload = OcrJobPayload;

// ─── Enqueue ──────────────────────────────────────────────────────────────────

interface EnqueueOptions {
  delaySecs?: number;
  retries?: number;
}

/**
 * Publish a job to QStash. The target URL must be a publicly reachable HTTPS
 * endpoint — QStash will POST the payload to it.
 */
export async function enqueueJob(
  path: string,
  payload: JobPayload,
  opts: EnqueueOptions = {}
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!token) {
    // Development fallback: import the handler and call it directly.
    // This keeps local dev working without a QStash account.
    await devFallback(path, payload);
    return;
  }

  const destination = `${appUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Upstash-Retries": String(opts.retries ?? 3),
  };
  if (opts.delaySecs) {
    headers["Upstash-Delay"] = `${opts.delaySecs}s`;
  }

  const res = await fetch(
    `https://qstash.upstash.io/v2/publish/${encodeURIComponent(destination)}`,
    { method: "POST", headers, body: JSON.stringify(payload) }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`QStash enqueue failed (${res.status}): ${detail}`);
  }
}

/**
 * Enqueue an OCR extraction job for an already-stored receipt.
 */
export async function enqueueOcrJob(
  receiptId: string,
  businessId: string
): Promise<void> {
  await enqueueJob("/api/queue/ocr", { type: "ocr", receiptId, businessId });
}

// ─── Dev fallback ─────────────────────────────────────────────────────────────

async function devFallback(path: string, payload: JobPayload): Promise<void> {
  if (path === "/api/queue/ocr") {
    const { runOcrJob } = await import("@/lib/queue/ocrJob");
    await runOcrJob(payload as OcrJobPayload);
    return;
  }
  console.warn(`[queue] No dev fallback for path: ${path}`);
}
