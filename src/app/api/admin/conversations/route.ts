import type { NextRequest } from "next/server";
import { aiEnabled } from "@/server/ai-config";
import { listAllConversations } from "@/server/db";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  return Response.json({
    conversations: await listAllConversations({ status: status === "open" || status === "closed" ? status : undefined }),
    aiEnabled: aiEnabled(),
  });
}
