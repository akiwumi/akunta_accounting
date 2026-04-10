/**
 * Storage abstraction for generated invoice PDFs.
 * Same provider model as lib/storage/receipts.ts.
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export type StoredInvoicePdf = {
  key: string;
  url: string;
};

const LOCAL_ROOT = join(process.cwd(), "uploads", "invoices");

const provider = (): "local" | "supabase" => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return "supabase";
  return "local";
};

// ─── Local ────────────────────────────────────────────────────────────────────

const localStore = async (buffer: Buffer, key: string): Promise<StoredInvoicePdf> => {
  await mkdir(LOCAL_ROOT, { recursive: true });
  const filePath = join(LOCAL_ROOT, key);
  await writeFile(filePath, buffer);
  return { key, url: filePath };
};

const localRead = async (key: string): Promise<Buffer> => readFile(join(LOCAL_ROOT, key));

const localDelete = async (key: string): Promise<void> => {
  try { await unlink(join(LOCAL_ROOT, key)); } catch { /* already gone */ }
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabaseStore = async (buffer: Buffer, key: string): Promise<StoredInvoicePdf> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_INVOICE_BUCKET ?? "invoices";
  const { error } = await supabase.storage.from(bucket).upload(key, buffer, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Supabase invoice storage failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return { key, url: data.publicUrl };
};

const supabaseRead = async (key: string): Promise<Buffer> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_INVOICE_BUCKET ?? "invoices";
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error || !data) throw new Error(`Supabase invoice read failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
};

const supabaseDelete = async (key: string): Promise<void> => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bucket = process.env.SUPABASE_INVOICE_BUCKET ?? "invoices";
  await supabase.storage.from(bucket).remove([key]);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const storeInvoicePdf = async (buffer: Buffer, key: string): Promise<StoredInvoicePdf> => {
  if (provider() === "supabase") return supabaseStore(buffer, key);
  return localStore(buffer, key);
};

export const readInvoicePdf = async (key: string): Promise<Buffer> => {
  if (provider() === "supabase") return supabaseRead(key);
  return localRead(key);
};

export const deleteInvoicePdf = async (key: string): Promise<void> => {
  if (provider() === "supabase") return supabaseDelete(key);
  return localDelete(key);
};
