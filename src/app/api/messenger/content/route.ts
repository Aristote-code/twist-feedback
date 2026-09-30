import type { NextRequest } from "next/server";
import type { MessengerContent } from "@/lib/messenger/content";
import { aiEnabled } from "@/server/ai-config";
import { listHelp, listUpdates } from "@/server/db";
import { publicApi } from "@/server/public-api";
import { corsHeaders } from "@/server/security";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Help centre and updates for the messenger, in the requested language (English where a translation is missing). */
export async function GET(request: NextRequest) {
  const { blocked, json } = publicApi(request);
  if (blocked) return json({ error: "This site isn't allowed to use the messenger." }, 403);
  const de = request.nextUrl.searchParams.get("locale") === "de";
  const pick = (v: { en: string; de: string }) => (de && v.de.trim() ? v.de : v.en);

  const content: MessengerContent = {
    collections: (await listHelp({ publishedOnly: true }))
      .filter((c) => c.articles.length)
      .map((c) => ({
        id: c.id,
        title: pick(c.title),
        description: pick(c.description),
        articles: c.articles.map((a) => ({ id: a.id, title: pick(a.title), body: pick(a.body), updatedAt: a.updatedAt })),
      })),
    updates: (await listUpdates({ publishedOnly: true })).map((u) => ({
      id: u.id,
      publishedAt: u.publishedAt,
      title: pick(u.title),
      body: pick(u.body),
      imageUrl: u.imageUrl,
    })),
    ai: { enabled: aiEnabled() },
  };
  return json(content);
}
