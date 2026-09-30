import type { NextRequest } from "next/server";
import { deleteArticle, deleteCollection } from "@/server/db";
import { adminOnly } from "@/server/admin-auth";

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/help/[kind]/[id]">) {
  const denied = await adminOnly();
  if (denied) return denied;
  const { kind, id } = await ctx.params;
  const ok = kind === "collection" ? await deleteCollection(id) : kind === "article" ? await deleteArticle(id) : false;
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
