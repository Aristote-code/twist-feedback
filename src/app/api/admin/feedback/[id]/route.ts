import type { NextRequest } from "next/server";
import { STATUSES, type Status } from "@/lib/feedback/config";
import { deleteFeedback, getFeedback, updateFeedback } from "@/server/db";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/admin/feedback/[id]">) {
  const { id } = await ctx.params;
  const item = await getFeedback(id, { withScreenshot: true });
  return item ? Response.json({ item }) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/admin/feedback/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { status?: string; internalNote?: string };
  if (body.status !== undefined && !STATUSES.includes(body.status as Status)) {
    return Response.json({ error: "Unknown status" }, { status: 400 });
  }
  const item = await updateFeedback(id, {
    status: body.status as Status | undefined,
    internalNote: typeof body.internalNote === "string" ? body.internalNote.slice(0, 5000) : undefined,
  });
  return item ? Response.json({ item }) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/feedback/[id]">) {
  const { id } = await ctx.params;
  return (await deleteFeedback(id)) ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
