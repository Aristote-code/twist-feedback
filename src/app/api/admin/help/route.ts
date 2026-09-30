import { badRequest, localized, optionalId } from "@/server/admin-input";
import { listHelp, saveArticle, saveCollection } from "@/server/db";

export async function GET() {
  return Response.json({ collections: await listHelp({ publishedOnly: false }) });
}

/** Create or update a collection ({kind: "collection"}) or an article ({kind: "article"}). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("The request body must be JSON.");

  if (body.kind === "collection") {
    const title = localized(body.title, 120);
    if (!title.en) return badRequest("Give the collection an English title.");
    const id = await saveCollection({
      id: optionalId(body.id),
      position: typeof body.position === "number" ? body.position : undefined,
      title,
      description: localized(body.description, 300),
    });
    return Response.json({ id });
  }

  if (body.kind === "article") {
    const title = localized(body.title, 200);
    const collectionId = optionalId(body.collectionId);
    if (!title.en) return badRequest("Give the article an English title.");
    if (!collectionId || !(await listHelp({ publishedOnly: false })).some((c) => c.id === collectionId)) {
      return badRequest("Pick a collection for the article.");
    }
    const id = await saveArticle({
      id: optionalId(body.id),
      collectionId,
      position: typeof body.position === "number" ? body.position : undefined,
      title,
      body: localized(body.body, 20000),
      published: body.published !== false,
    });
    return Response.json({ id });
  }

  return badRequest('kind must be "collection" or "article".');
}
