import { after, type NextRequest } from "next/server";
import { aiEnabled } from "@/server/ai-config";
import { replyToConversation } from "@/server/assistant";
import { getConversation, listMessages, setConversationMode, setConversationStatus } from "@/server/db";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/admin/conversations/[id]">) {
  const { id } = await ctx.params;
  const conversation = await getConversation(id);
  if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ conversation, messages: await listMessages(id) });
}

/** Change status (open/closed) and/or who answers (mode: ai/human). */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/admin/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!(await getConversation(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const { status, mode } = (await request.json().catch(() => ({}))) as { status?: string; mode?: string };
  if (status !== undefined && status !== "open" && status !== "closed") {
    return Response.json({ error: "Unknown status" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "ai" && mode !== "human") {
    return Response.json({ error: "Unknown mode" }, { status: 400 });
  }
  if (mode === "ai" && !aiEnabled()) {
    return Response.json({ error: "The AI assistant is off. Add an Anthropic API key to turn it on." }, { status: 400 });
  }
  if (status) await setConversationStatus(id, status);
  if (mode) await setConversationMode(id, mode, mode === "human" ? "A team member took over." : null);

  // Handed back to the AI while a parent is waiting: answer them now. The
  // widget shows the typing dots and picks up the reply when it polls.
  const conversation = (await getConversation(id))!;
  if (mode === "ai" && conversation.status === "open") {
    after(() => replyToConversation(conversation).catch((err) => console.error("[assistant]", err)));
  }
  return Response.json({ conversation });
}
