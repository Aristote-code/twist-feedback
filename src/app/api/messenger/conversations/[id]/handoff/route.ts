import { MESSENGER_STRINGS } from "@/lib/messenger/content";
import { addMessage, getOwnedConversation, setConversationMode } from "@/server/db";
import { publicApi, toChatMessage, toSummary } from "@/server/public-api";
import { corsHeaders } from "@/server/security";
import { resolveOwner } from "@/server/visitor";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** "Talk to a person": the assistant steps back and the team is asked to reply. */
export async function POST(request: Request, ctx: RouteContext<"/api/messenger/conversations/[id]/handoff">) {
  const { blocked, json } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  const { id } = await ctx.params;
  const owner = resolveOwner(request);
  const conversation = owner ? await getOwnedConversation(id, owner.ownerKey) : null;
  if (!conversation) return json({ error: "Conversation not found." }, 404);
  if (conversation.mode === "human") return json({ conversation: toSummary(conversation), message: null });

  const t = MESSENGER_STRINGS[conversation.locale === "de" ? "de" : "en"];
  const message = await addMessage(id, "ai", t.assistantName, t.handedOff, { handoff: true });
  const updated = (await setConversationMode(id, "human", "The parent asked to talk to a person."))!;
  return json({ conversation: toSummary(updated), message: toChatMessage(message) });
}
