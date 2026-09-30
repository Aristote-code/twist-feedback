import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, isValidSession } from "./admin-session";

// Every admin page and API route checks the session itself, rather than
// relying on a proxy in front: Netlify can't run Next's Node proxy, and a
// check next to the data is the safer place for it anyway.

async function signedIn(): Promise<boolean> {
  return isValidSession((await cookies()).get(ADMIN_COOKIE)?.value);
}

/** For admin API routes: a 401 response to return, or null when signed in. */
export async function adminOnly(): Promise<Response | null> {
  if (await signedIn()) return null;
  return Response.json({ error: "Sign in to the feedback admin first." }, { status: 401 });
}

/** For admin pages: sends visitors who aren't signed in to the login page. */
export async function requireAdmin(path: string): Promise<void> {
  if (!(await signedIn())) redirect(`/admin/login?next=${encodeURIComponent(path)}`);
}
