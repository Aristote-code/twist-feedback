import "server-only";
import type { ChatMessage, ConversationSummary, SendEvent } from "@/lib/messenger/content";
import { replyToConversation } from "./assistant";
import { getConversation, type ConversationRecord, type MessageRecord } from "./db";
import { corsHeaders } from "./security";

/** CORS headers plus a JSON helper for endpoints the widget calls from other sites. */
export function publicApi(request: Request) {
  const headers = corsHeaders(request);
  const blocked = !!request.headers.get("origin") && !headers["Access-Control-Allow-Origin"];
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  return { headers, blocked, json };
}

export function toSummary(c: ConversationRecord): ConversationSummary {
  return {
    id: c.id,
    createdAt: c.createdAt,
    lastMessageAt: c.lastMessageAt,
    lastMessage: c.lastMessage.slice(0, 140),
    lastAuthor: c.lastAuthor,
    status: c.status,
    mode: c.mode,
    aiBusy: c.aiBusy,
  };
}

export function toChatMessage(m: MessageRecord): ChatMessage {
  return { id: m.id, createdAt: m.createdAt, author: m.author, authorName: m.authorName, body: m.body, meta: m.meta };
}

/**
 * Streams the result of sending a message: the saved message, then (when the
 * assistant is handling the conversation) its reply as it's written, one JSON
 * event per line. The reply is generated and saved even if the visitor closes
 * the widget halfway through.
 */
export function streamSend(headers: Record<string, string>, first: SendEvent[], conversationId: string): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  const send = (event: SendEvent) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
    } catch {
      closed = true;
    }
  };

  (async () => {
    first.forEach(send);
    const conversation = await getConversation(conversationId);
    if (!conversation) return;
    const modeBefore = conversation.mode;
    const reply = await replyToConversation(conversation, {
      onStart: () => send({ type: "ai_start" }),
      onDelta: (text) => send({ type: "ai_delta", text }),
    });
    if (reply) send({ type: "ai_message", message: toChatMessage(reply) });
    const after = await getConversation(conversationId);
    if (after && after.mode !== modeBefore) send({ type: "mode", mode: after.mode });
  })()
    .catch((err) => {
      console.error("[messenger] send failed", err);
      send({ type: "error", error: "Something went wrong while replying." });
    })
    .finally(() => {
      if (closed) return;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    });

  return new Response(body, {
    status: 201,
    headers: {
      ...headers,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
