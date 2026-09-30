import type { NextRequest } from "next/server";
import { aiEnabled } from "@/server/ai-config";
import { listAllConversations } from "@/server/db";
import { adminOnly } from "@/server/admin-auth";

export async function GET(request: NextRequest) {
  const denied = await adminOnly();
  if (denied) return denied;
  const status = request.nextUrl.searchParams.get("status");
  return Response.json({
    conversations: await listAllConversations({ status: status === "open" || status === "closed" ? status : undefined }),
    aiEnabled: aiEnabled(),
  });
}
