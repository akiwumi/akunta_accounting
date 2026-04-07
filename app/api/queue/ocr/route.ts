/**
 * POST /api/queue/ocr
 *
 * QStash webhook — processes an OCR extraction job for a stored receipt.
 *
 * QStash signs the request with a JWT in the `Upstash-Signature` header.
 * Signature verification uses HMAC-SHA256 with QSTASH_CURRENT_SIGNING_KEY
 * (or QSTASH_NEXT_SIGNING_KEY as fallback during key rotation).
 *
 * When QSTASH_CURRENT_SIGNING_KEY is absent (local dev without QStash), the
 * handler runs without signature verification — guarded by a dev-mode check.
 */

import { NextResponse } from "next/server";

import { runOcrJob } from "@/lib/queue/ocrJob";
import type { OcrJobPayload } from "@/lib/queue/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Signature verification ───────────────────────────────────────────────────

function base64urlDecode(input: string): ArrayBuffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function verifyQStashJwt(jwt: string, body: string, signingKey: string): Promise<boolean> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  // The QStash signing key starts with "sig_" followed by a base64url-encoded
  // secret. Strip the prefix and decode to get the raw HMAC key bytes.
  const rawKey = signingKey.startsWith("sig_") ? signingKey.slice(4) : signingKey;
  const keyBytes = base64urlDecode(rawKey);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBytes = base64urlDecode(sigB64);

  const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, message);
  if (!valid) return false;

  // Decode payload
  let payload: { exp?: number; nbf?: number; body?: string };
  try {
    payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as typeof payload;
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return false;
  if (payload.nbf && payload.nbf > now + 60) return false; // 60 s clock tolerance

  // Verify body hash (SHA-256 hex of the raw body)
  if (payload.body) {
    const bodyHashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body)
    );
    const bodyHash = Array.from(new Uint8Array(bodyHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (payload.body !== bodyHash) return false;
  }

  return true;
}

async function isAuthorized(request: Request, rawBody: string): Promise<boolean> {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  // No signing keys configured: allow only in non-production environments.
  if (!currentKey) {
    return process.env.NODE_ENV !== "production";
  }

  const signature = request.headers.get("Upstash-Signature");
  if (!signature) return false;

  if (await verifyQStashJwt(signature, rawBody, currentKey)) return true;
  if (nextKey && (await verifyQStashJwt(signature, rawBody, nextKey))) return true;

  return false;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!(await isAuthorized(request, rawBody))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let job: OcrJobPayload;
  try {
    job = JSON.parse(rawBody) as OcrJobPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (job.type !== "ocr" || !job.receiptId || !job.businessId) {
    return NextResponse.json({ error: "Invalid job payload." }, { status: 400 });
  }

  try {
    await runOcrJob(job);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Return 500 so QStash retries the job
    const message = err instanceof Error ? err.message : "OCR job failed.";
    console.error(`[queue/ocr] Job failed for receiptId=${job.receiptId}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
