/**
 * Storage abstraction for receipt files.
 *
 * Current implementation: local filesystem (dev/self-hosted).
 * Production path: swap provider to Supabase Storage by setting STORAGE_PROVIDER=supabase
 * and providing SUPABASE_STORAGE_BUCKET + SUPABASE_SERVICE_ROLE_KEY.
 *
 * The interface is provider-agnostic so callers don't change when the backend changes.
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type StoredFile = {
  /** Opaque key used to retrieve or delete the file */
  key: string;
  /** Original file name */
  originalName: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Provider-specific URL or local path */
  url: string;
};

// ─── Provider detection ───────────────────────────────────────────────────────

const provider = (): "local" | "supabase" => {
  if (process.env.STORAGE_PROVIDER === "supabase") return "supabase";
  return "local";
};

// ─── Local filesystem provider ────────────────────────────────────────────────

const LOCAL_ROOT = join(process.cwd(), "uploads", "receipts");

const sanitizeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

const localStore = async (buffer: Buffer, originalName: string, mimeType: string): Promise<StoredFile> => {
  await mkdir(LOCAL_ROOT, { recursive: true });
  const key = `${Date.now()}-${randomUUID()}-${sanitizeName(originalName)}`;
  const filePath = join(LOCAL_ROOT, key);
  await writeFile(filePath, buffer);
  return { key, originalName, mimeType, size: buffer.length, url: filePath };
};

const localRead = async (key: string): Promise<Buffer> => readFile(join(LOCAL_ROOT, key));

const localDelete = async (key: string): Promise<void> => {
  try { await unlink(join(LOCAL_ROOT, key)); } catch { /* already gone */ }
};

// ─── Supabase Storage provider ────────────────────────────────────────────────

const supabaseStore = async (buffer: Buffer, originalName: string, mimeType: string): Promise<StoredFile> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "receipts";
  const key = `${Date.now()}-${randomUUID()}-${sanitizeName(originalName)}`;
  const { error } = await supabase.storage.from(bucket).upload(key, buffer, { contentType: mimeType });
  if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return { key, originalName, mimeType, size: buffer.length, url: data.publicUrl };
};

const supabaseRead = async (key: string): Promise<Buffer> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "receipts";
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error || !data) throw new Error(`Supabase storage read failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
};

const supabaseDelete = async (key: string): Promise<void> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "receipts";
  await supabase.storage.from(bucket).remove([key]);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const storeReceiptFile = async (
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<StoredFile> => {
  if (provider() === "supabase") return supabaseStore(buffer, originalName, mimeType);
  return localStore(buffer, originalName, mimeType);
};

export const readReceiptFile = async (key: string): Promise<Buffer> => {
  if (provider() === "supabase") return supabaseRead(key);
  return localRead(key);
};

export const deleteReceiptFile = async (key: string): Promise<void> => {
  if (provider() === "supabase") return supabaseDelete(key);
  return localDelete(key);
};
