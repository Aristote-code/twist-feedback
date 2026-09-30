import { badRequest, localized, optionalId } from "@/server/admin-input";
import { listUpdates, saveUpdate } from "@/server/db";
import { adminOnly } from "@/server/admin-auth";

export async function GET() {
  const denied = await adminOnly();
  if (denied) return denied;
  return Response.json({ updates: await listUpdates({ publishedOnly: false }) });
}

/** Create or update an update post. */
export async function POST(request: Request) {
  const denied = await adminOnly();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("The request body must be JSON.");
  const title = localized(body.title, 200);
  if (!title.en) return badRequest("Give the update an English title.");
  const date = typeof body.publishedAt === "string" ? new Date(body.publishedAt) : new Date();
  if (Number.isNaN(date.getTime())) return badRequest("The publish date isn't a valid date.");
  const imageUrl = typeof body.imageUrl === "string" && /^https?:\/\/\S+$/.test(body.imageUrl.trim()) ? body.imageUrl.trim() : null;
  const id = await saveUpdate({
    id: optionalId(body.id),
    publishedAt: date.toISOString(),
    title,
    body: localized(body.body, 20000),
    imageUrl,
    published: body.published !== false,
  });
  return Response.json({ id });
}
