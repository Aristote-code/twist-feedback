import { findCategory, LIMITS, LOCALES, type FeedbackSubmission, type Locale } from "@/lib/feedback/config";
import { createFeedback } from "@/server/db";
import { corsHeaders, rateLimited, verifyUserHash } from "@/server/security";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCREENSHOT_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });

  if (request.headers.get("origin") && !headers["Access-Control-Allow-Origin"]) {
    return fail("This site isn't allowed to send feedback.", 403);
  }
  if (rateLimited(request)) return fail("Too many submissions. Try again in a few minutes.", 429);

  let body: FeedbackSubmission;
  try {
    body = await request.json();
  } catch {
    return fail("The request body must be JSON.");
  }

  // Bots fill every field; pretend it worked so they don't retry.
  if (body.website) return Response.json({ ok: true }, { status: 201, headers });

  const category = findCategory(str(body.category, 50));
  if (!category) return fail("Pick a category.");

  const title = str(body.title, LIMITS.titleMax);
  if (title.length < LIMITS.titleMin) return fail(`Add a title of at least ${LIMITS.titleMin} characters.`);

  const postTypeId = str(body.postType, 50);
  const postType = category.postTypes.some((p) => p.id === postTypeId) ? postTypeId : null;

  const locale: Locale | null = LOCALES.includes(body.locale as Locale) ? (body.locale as Locale) : null;

  const screenshot = typeof body.screenshot === "string" ? body.screenshot : null;
  if (screenshot && (screenshot.length > LIMITS.screenshotMaxChars || !SCREENSHOT_RE.test(screenshot))) {
    return fail("The screenshot is too large or not an image.");
  }

  const metadata: Record<string, string> = {};
  if (body.metadata && typeof body.metadata === "object") {
    for (const [k, v] of Object.entries(body.metadata).slice(0, LIMITS.metadataKeys)) {
      metadata[str(k, 50)] = str(v, LIMITS.metadataValueMax);
    }
  }
  const ua = request.headers.get("user-agent");
  if (ua) metadata.userAgent = ua.slice(0, LIMITS.metadataValueMax);

  const user = body.user && typeof body.user.id === "string" ? body.user : null;
  const email = str(user?.email || body.email, 200);

  const record = await createFeedback({
    category: category.id,
    postType,
    title,
    description: str(body.description, LIMITS.descriptionMax),
    source: str(body.source, 50) || "unknown",
    locale,
    pageUrl: str(body.pageUrl, 500) || null,
    userId: user ? str(user.id, 100) : null,
    userName: user ? str(user.name, 100) || null : null,
    userEmail: EMAIL_RE.test(email) ? email : null,
    userVerified: user ? verifyUserHash(user.id, user.hash) : false,
    metadata,
    screenshot,
  });

  return Response.json({ ok: true, id: record.id }, { status: 201, headers });
}
