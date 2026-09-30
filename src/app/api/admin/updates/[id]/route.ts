import type { NextRequest } from "next/server";
import { deleteUpdate } from "@/server/db";

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/updates/[id]">) {
  const { id } = await ctx.params;
  return (await deleteUpdate(id)) ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
