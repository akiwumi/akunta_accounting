import { NextResponse } from "next/server";

import { requireAuthContext } from "@/lib/auth/context";
import { requireBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { inferReceiptMimeType } from "@/lib/receipts/mime";
import { storeReceiptFile } from "@/lib/storage/receipts";
import { enqueueOcrJob } from "@/lib/queue/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/receipts/upload
 *
 * Stores the uploaded file, creates a stub Receipt record marked needsReview,
 * and enqueues an async OCR job to extract data and post the transaction.
 *
 * The caller receives the stub receipt immediately; the OCR result is applied
 * asynchronously. In development (no QSTASH_TOKEN), extraction runs inline.
 */
export async function POST(request: Request) {
  try {
    const { businessId } = await requireAuthContext();
    await requireBusiness(businessId);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
    }

    const effectiveMimeType = inferReceiptMimeType(file.name, file.type);
    const buffer = Buffer.from(await file.arrayBuffer());

    // Store the file first so the key is stable before the job runs.
    const stored = await storeReceiptFile(buffer, file.name, effectiveMimeType);

    // Create a minimal stub — OCR will fill in the rest.
    const receipt = await prisma.receipt.create({
      data: {
        businessId,
        source: "upload",
        originalFileName: file.name,
        mimeType: effectiveMimeType,
        filePath: stored.url,
        needsReview: true,
      },
    });

    // Enqueue the OCR job. In dev (no QSTASH_TOKEN) this runs inline.
    await enqueueOcrJob(receipt.id, businessId);

    return NextResponse.json({ receipt, queued: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Receipt upload failed." },
      { status: 500 }
    );
  }
}
