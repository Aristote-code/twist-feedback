// Session tokens for the admin: HMAC-signed expiry times, using Web Crypto.

export const ADMIN_COOKIE = "twist_feedback_admin";
const SESSION_DAYS = 7;

function secret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

async function hmac(key: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(candidate, expected);
}

export async function createSessionToken(): Promise<{ token: string; maxAge: number }> {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD is not set");
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expires = String(Date.now() + maxAge * 1000);
  return { token: `${expires}.${await hmac(key, expires)}`, maxAge };
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await hmac(key, expires));
}
