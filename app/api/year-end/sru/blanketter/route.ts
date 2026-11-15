/**
 * GET /api/year-end/sru/blanketter?year=2026
 *
 * Downloads BLANKETTER.SRU for the NE-bilaga of that income year. The file is built
 * from the ledger and the answers saved in the guided year-end at the moment
 * of the request.
 */

import { sruDownload } from "@/lib/tax/sruDownload";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return sruDownload(request, "blanketter");
}
