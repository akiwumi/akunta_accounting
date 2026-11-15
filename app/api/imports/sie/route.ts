import { NextResponse } from "next/server";

import { ledgerErrorResponse } from "@/lib/accounting/ledger";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { executeSieImport, previewSieImport, SieImportError, SIE_MAX_BYTES } from "@/lib/sie/import";
import { sieMessage } from "@/lib/sie/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/imports/sie   (multipart form: file, mode)
 *
 *   mode=preview  reads the file and answers with what an import would do.
 *                 Nothing is written.
 *   mode=confirm  imports the file. The file is sent again and checked again,
 *                 so what is written is always what the server itself read.
 *
 * Both answer with { preview }, and confirm adds { result } on success.
 */
export async function POST(request: Request) {
  let businessId: string;
  let userId: string;
  try {
    ({ businessId, userId } = await requireAuthContext());
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const locale = await getRequestLocale();
  const sv = locale === "sv";

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: sv ? "Ingen fil togs emot. Välj SIE-filen och försök igen." : "No file was received. Choose the SIE file and try again." },
      { status: 400 }
    );
  }
  const file = formData.get("file");
  const mode = formData.get("mode") === "confirm" ? "confirm" : "preview";
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: sv ? "Ingen fil togs emot. Välj SIE-filen och försök igen." : "No file was received. Choose the SIE file and try again." },
      { status: 400 }
    );
  }
  if (file.size > SIE_MAX_BYTES) {
    return NextResponse.json(
      { error: sieMessage(locale, "TOO_LARGE", { limit: SIE_MAX_BYTES / (1024 * 1024) }) },
      { status: 413 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    if (mode === "preview") {
      const preview = await previewSieImport(prisma, { businessId, bytes, locale });
      return NextResponse.json({ preview });
    }

    const result = await executeSieImport(prisma, { businessId, userId, bytes, fileName: file.name, locale });
    return NextResponse.json({
      preview: result.preview,
      result: {
        vouchersImported: result.vouchersImported,
        accountsCreated: result.accountsCreated,
        openingBalancesImported: result.openingBalancesImported,
        firstVerificationNumber: result.firstVerificationNumber,
        lastVerificationNumber: result.lastVerificationNumber
      }
    });
  } catch (error) {
    if (error instanceof SieImportError) {
      return NextResponse.json({ error: error.message, preview: error.preview }, { status: 422 });
    }
    // A database trigger said no (locked period, unbalanced entry). The
    // transaction was rolled back, so nothing was written.
    const ledger = ledgerErrorResponse(error);
    if (ledger) {
      const message = ledger.message;
      return NextResponse.json(
        {
          error: sv
            ? `Importen stoppades av bokföringsreglerna och inget har sparats. ${message}`
            : `The import was stopped by the ledger rules and nothing was saved. ${message}`
        },
        { status: ledger.status }
      );
    }
    console.error("[sie-import]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: sv
          ? "Importen kunde inte genomföras och inget har sparats. Försök igen; om det händer igen, kontakta supporten och bifoga filen."
          : "The import could not be completed and nothing was saved. Try again; if it happens again, contact support and attach the file."
      },
      { status: 500 }
    );
  }
}
