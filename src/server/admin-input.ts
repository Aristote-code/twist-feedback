import "server-only";

// Small validators for admin forms.

export function localized(value: unknown, max: number): { en: string; de: string } {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  return { en: s(v.en), de: s(v.de) };
}

export function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value) ? value : undefined;
}

export function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}
