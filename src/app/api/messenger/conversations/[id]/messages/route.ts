import { MESSAGE_MAX } from "@/lib/messenger/content";
import { addMessage, getOwnedConversation } from "@/server/db";
import { publicApi, streamSend, toChatMessage } from "@/server/public-api";
import { corsHeaders, rateLimited } from "@/server/security";
import { resolveOwner } from "@/server/visitor";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request, ctx: RouteContext<"/api/messenger/conversations/[id]/messages">) {
  const { blocked, json, headers } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  if (rateLimited(request)) return json({ error: "Too many messages. Try again in a few minutes." }, 429);

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const owner = resolveOwner(request, { name: body?.name, email: body?.email });
  const conversation = owner ? await getOwnedConversation(id, owner.ownerKey) : null;
  if (!owner || !conversation) return json({ error: "Conversation not found." }, 404);

  const text = typeof body?.message === "string" ? body.message.trim().slice(0, MESSAGE_MAX) : "";
  if (!text) return json({ error: "Write a message first." }, 400);

  const message = await addMessage(id, "visitor", owner.userName, text);
  return streamSend(headers, [{ type: "message", message: toChatMessage(message) }], id);
}
