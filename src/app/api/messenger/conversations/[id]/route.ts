import { getOwnedConversation, listMessages } from "@/server/db";
import { publicApi, toChatMessage, toSummary } from "@/server/public-api";
import { corsHeaders } from "@/server/security";
import { resolveOwner } from "@/server/visitor";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request, ctx: RouteContext<"/api/messenger/conversations/[id]">) {
  const { blocked, json } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  const { id } = await ctx.params;
  const owner = resolveOwner(request);
  const conversation = owner ? await getOwnedConversation(id, owner.ownerKey) : null;
  if (!conversation) return json({ error: "Conversation not found." }, 404);
  return json({ conversation: toSummary(conversation), messages: (await listMessages(id)).map(toChatMessage) });
}
