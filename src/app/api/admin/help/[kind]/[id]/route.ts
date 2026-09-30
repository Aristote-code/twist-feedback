import type { NextRequest } from "next/server";
import { deleteArticle, deleteCollection } from "@/server/db";

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/help/[kind]/[id]">) {
  const { kind, id } = await ctx.params;
  const ok = kind === "collection" ? deleteCollection(id) : kind === "article" ? deleteArticle(id) : false;
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
