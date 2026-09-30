import "server-only";
import type { ConversationOwner } from "./db";
import { verifyUserHash } from "./security";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

function header(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * Who owns the conversations this request is about.
 * - A parent with a valid identity hash owns them by user id, on any device.
 * - Everyone else owns them through a random token the widget keeps in
 *   localStorage. Knowing a user id alone is never enough to read messages.
 */
export function resolveOwner(
  request: Request,
  profile: { name?: unknown; email?: unknown } = {},
): ConversationOwner | null {
  const userId = header(request, "x-twist-user-id");
  const hash = header(request, "x-twist-user-hash");
  const token = header(request, "x-twist-visitor");
  const name = typeof profile.name === "string" ? profile.name.trim().slice(0, 100) || null : null;
  const email =
    typeof profile.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())
      ? profile.email.trim().slice(0, 200)
      : null;

  if (userId && verifyUserHash(userId, hash ?? undefined)) {
    return { ownerKey: `user:${userId}`, userId, userName: name, userEmail: email, userVerified: true };
  }
  if (token && TOKEN_RE.test(token)) {
    return { ownerKey: `anon:${token}`, userId, userName: name, userEmail: email, userVerified: false };
  }
  return null;
}
