import { LOCALES, type Locale } from "@/lib/feedback/config";
import { MESSAGE_MAX } from "@/lib/messenger/content";
import { aiEnabled } from "@/server/ai-config";
import { createConversation, listConversationsForOwner } from "@/server/db";
import { publicApi, streamSend, toChatMessage, toSummary } from "@/server/public-api";
import { corsHeaders, rateLimited } from "@/server/security";
import { resolveOwner } from "@/server/visitor";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const { blocked, json } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  const owner = resolveOwner(request);
  if (!owner) return json({ conversations: [] });
  return json({ conversations: (await listConversationsForOwner(owner.ownerKey)).map(toSummary) });
}

export async function POST(request: Request) {
  const { blocked, json, headers } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  if (rateLimited(request)) return json({ error: "Too many messages. Try again in a few minutes." }, 429);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "The request body must be JSON." }, 400);

  const owner = resolveOwner(request, { name: body.name, email: body.email });
  if (!owner) return json({ error: "Missing visitor token." }, 400);

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MESSAGE_MAX) : "";
  if (!message) return json({ error: "Write a message first." }, 400);

  const locale = LOCALES.includes(body.locale as Locale) ? (body.locale as string) : null;
  const { conversation, message: first } = await createConversation(
    owner,
    {
      source: typeof body.source === "string" ? body.source.slice(0, 50) : "unknown",
      locale,
      pageUrl: typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 500) : null,
      mode: aiEnabled() ? "ai" : "human",
    },
    message,
  );
  return streamSend(
    headers,
    [
      { type: "conversation", conversation: toSummary(conversation) },
      { type: "message", message: toChatMessage(first) },
    ],
    conversation.id,
  );
}
