import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Identity verification, the same idea as Intercom's or Featurebase's:
 * Twist's own server computes HMAC-SHA256(FEEDBACK_IDENTITY_SECRET, userId)
 * and passes it to the widget as `user.hash`. Without a valid hash the
 * name and email are kept, but the post is marked unverified.
 */
export function signUserId(userId: string): string | null {
  const secret = process.env.FEEDBACK_IDENTITY_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(userId).digest("hex");
}

export function verifyUserHash(userId: string, hash: string | undefined): boolean {
  const expected = signUserId(userId);
  if (!expected || !hash) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Origins allowed to call the public API: this app plus FEEDBACK_ALLOWED_ORIGINS. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const allowed = (process.env.FEEDBACK_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const self = new URL(request.url).origin;
  if (origin !== self && !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Twist-Visitor, X-Twist-User-Id, X-Twist-User-Hash",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Simple per-IP limit. It lives in memory, so it resets on restart and is
// per server instance; put a shared limiter in front for multi-instance hosting.
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;

export function rateLimited(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}
