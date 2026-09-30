// Downloads the icons listed in design/hugeicons/manifest.json from our Figma
// library in one request, then rebuilds src/components/icons/hugeicons.tsx.
//
//   FIGMA_TOKEN=<your token> node scripts/fetch-figma-icons.mjs            # solid (default)
//   FIGMA_TOKEN=<your token> node scripts/fetch-figma-icons.mjs --stroke   # stroke
//
// Create the token in Figma: Settings → Security → Personal access tokens,
// with the "File content: read" scope. Keep it out of the repo.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = new URL("../design/hugeicons/manifest.json", import.meta.url);
const DIR = new URL("../design/hugeicons/", import.meta.url);

const token = process.env.FIGMA_TOKEN;
if (!token) {
  console.error("Set FIGMA_TOKEN first. Create one in Figma: Settings → Security → Personal access tokens (scope: File content, read).");
  process.exit(1);
}

const style = process.argv.includes("--stroke") ? "stroke" : "solid";
const { figmaFile, icons } = JSON.parse(readFileSync(MANIFEST, "utf8"));
const wanted = icons.filter((i) => i[style]);
const missing = icons.filter((i) => !i[style]).map((i) => i.name);
if (missing.length) console.warn(`No ${style} node id for: ${missing.join(", ")}`);

const ids = wanted.map((i) => i[style]).join(",");
const api = `https://api.figma.com/v1/images/${figmaFile}?format=svg&svg_include_id=false&svg_simplify_stroke=true&ids=${encodeURIComponent(ids)}`;
const res = await fetch(api, { headers: { "X-Figma-Token": token } });
const body = await res.json().catch(() => ({}));
if (!res.ok || body.err) {
  console.error(`Figma refused the request (${res.status}): ${body.err || body.message || "unknown error"}`);
  process.exit(1);
}

let saved = 0;
for (const icon of wanted) {
  const url = body.images?.[icon[style]];
  if (!url) {
    console.warn(`  ✗ ${icon.name}: Figma returned no image`);
    continue;
  }
  const svg = await fetch(url).then((r) => r.text());
  writeFileSync(new URL(`${icon.name}.svg`, DIR), svg);
  saved++;
  console.log(`  ✓ ${icon.name}`);
}
console.log(`Saved ${saved}/${wanted.length} ${style} icons to design/hugeicons/`);

execFileSync(process.execPath, [new URL("./build-icons.mjs", import.meta.url).pathname], { stdio: "inherit" });
