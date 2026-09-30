import type { NextRequest } from "next/server";
import { STATUSES, type Status } from "@/lib/feedback/config";
import { countByStatus, listFeedback } from "@/server/db";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const items = await listFeedback({
    status: STATUSES.includes(status as Status) ? (status as Status) : undefined,
    category: params.get("category") || undefined,
    q: params.get("q")?.trim() || undefined,
  });
  return Response.json({ items, counts: await countByStatus() });
}
