import type { NextRequest } from "next/server";
import { MESSAGE_MAX } from "@/lib/messenger/content";
import { addMessage, getConversation } from "@/server/db";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/admin/conversations/[id]/messages">) {
  const { id } = await ctx.params;
  if (!(await getConversation(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { message?: string; authorName?: string };
  const text = typeof body.message === "string" ? body.message.trim().slice(0, MESSAGE_MAX) : "";
  if (!text) return Response.json({ error: "Write a reply first." }, { status: 400 });
  const authorName = typeof body.authorName === "string" ? body.authorName.trim().slice(0, 60) || null : null;
  return Response.json({ message: await addMessage(id, "team", authorName, text) }, { status: 201 });
}
