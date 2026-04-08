import { handleRegisterRequest } from "@/lib/auth/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRegisterRequest(request);
}
