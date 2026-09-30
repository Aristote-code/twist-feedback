// Generates the messenger's header background (src/components/twist-messenger/hero.png).
//
// It is drawn from scratch, not copied: a brightness map measured from a
// reference screenshot (dark centre, violet "curtains" at the sides, a fade
// to the panel colour), plus seeded vertical streaks and film grain.
//
//   node scripts/generate-messenger-hero.mjs

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const W = 429; // .hero is the 405px panel plus 12px bleed on each side
const H = 520;
const BLEED = 12;
const BG = [10, 11, 16];

// Brightness (0–255 luma) measured every 20px across, centred on x = 10, 30 … 390,
// at these panel y positions.
const row97 = [54, 54, 49, 39, 28, 25, 22, 22, 21, 21, 21, 21, 21, 22, 23, 25, 31, 38, 55, 65, 80].slice(1);
const row205 = [60, 62, 60, 54, 46, 44, 39, 38, 36, 35, 35, 35, 36, 38, 41, 44, 49, 54, 63, 69, 81].slice(1);
const row373 = [85, 83, 81, 77, 76, 73, 72, 71, 70, 71, 71, 72, 73, 75, 77, 79, 81, 85, 86, 86];
const scale = (row, k) => row.map((v) => v * k);
const ROWS = [
  [17, [88, 86, 79, 69, 63, 52, 48, 42, 38, 37, 35, 36, 40, 45, 52, 62, 69, 80, 82, 81]],
  [70, [64, 60, 47, 33, 29, 23, 22, 21, 20, 21, 21, 21, 22, 24, 27, 36, 45, 64, 73, 86]],
  [97, row97],
  [150, row97.map((v, i) => (v + row205[i]) / 2)],
  [205, row205],
  [281, [88, 84, 78, 72, 70, 65, 63, 62, 60, 61, 60, 61, 64, 66, 71, 76, 79, 88, 92, 101]],
  [373, row373],
  [420, scale(row373, 0.9)],
  [445, scale(row373, 0.6)],
  [470, scale(row373, 0.3)],
  [495, scale(row373, 0.14)],
  [520, Array(20).fill(10.5)],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Catmull-Rom interpolation keeps the curtains smooth between samples.
function cubic(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleRow(values, x) {
  const u = clamp((x - 10) / 20, 0, values.length - 1);
  const i = Math.floor(u);
  const at = (k) => values[clamp(k, 0, values.length - 1)];
  return cubic(at(i - 1), at(i), at(i + 1), at(i + 2), u - i);
}

function baseLuma(x, y) {
  const ys = ROWS.map((r) => r[0]);
  let k = ys.findIndex((ry) => ry > y) - 1;
  if (k < 0) k = y < ys[0] ? 0 : ROWS.length - 2;
  const t = clamp((y - ys[k]) / (ys[k + 1] - ys[k]), 0, 1);
  const at = (j) => sampleRow(ROWS[clamp(j, 0, ROWS.length - 1)][1], x);
  return cubic(at(k - 1), at(k), at(k + 1), at(k + 2), t);
}

// Seeded random numbers, so the image is the same every run.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260929);

// Vertical streaks: mostly soft darker bands a few pixels wide, some lighter
// ones, each drifting in strength along its length like light through a blind.
const streaks = [];
for (let i = 0; i < 30; i++) {
  streaks.push({ x: rand() * W, w: 1.5 + rand() * 4.5, a: -(3 + rand() * 6), f: 60 + rand() * 120, p: rand() * 6.28 });
}
for (let i = 0; i < 16; i++) {
  streaks.push({ x: rand() * W, w: 1 + rand() * 4, a: 2 + rand() * 4, f: 60 + rand() * 120, p: rand() * 6.28 });
}
const fine = Array.from({ length: W }, () => (rand() - 0.5) * 2.4);

// Grain measured on the reference: standard deviation ~3.3 per channel,
// channels moving together, neighbouring pixels nearly independent.
const GRAIN = 3.3;
let spare = null;
function gaussian() {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return v;
  }
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  spare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}

const raw = Buffer.alloc(H * (1 + W * 3));
const pixels = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 3);
  const py = y - BLEED; // panel coordinates, matching the measurements
  const bottom = clamp((py - 380) / 120, 0, 1);
  const streakFade = 1 - 0.5 * clamp(py / 450, 0, 1);
  const grainFade = 1 - clamp((py - 430) / 75, 0, 1);

  for (let x = 0; x < W; x++) {
    const px = x - BLEED;
    let l = baseLuma(px, py);

    let s = fine[x];
    for (const st of streaks) {
      const d = (x - st.x) / st.w;
      if (d > 3 || d < -3) continue;
      s += st.a * Math.exp(-d * d) * (0.7 + 0.3 * Math.sin(py / st.f + st.p));
    }
    l += s * streakFade * clamp(l / 80, 0.25, 1.2);
    l = Math.max(l, 9.5);

    // Violet tint: darker areas are bluer, the bottom less saturated.
    const blue = 1.58 + 0.42 * clamp((70 - l) / 50, 0, 1) - 0.22 * bottom;
    let rgb = [l * 0.97, l * (0.89 + 0.07 * bottom), l * blue];

    // Land exactly on the panel background at the bottom edge.
    const settle = clamp((py - 470) / 38, 0, 1);
    rgb = rgb.map((c, i) => c + (BG[i] - c) * settle);

    // Film grain: grey (the same for R, G and B), one pixel fine, about 3.3
    // levels strong, fading out where the header meets the panel background.
    const n = gaussian() * GRAIN * grainFade;

    const o = rowStart + 1 + x * 3;
    for (let c = 0; c < 3; c++) raw[o + c] = clamp(Math.round(rgb[c] + n), 0, 255);
  }
}

// PNG row filters: pick, per row, the one that leaves the smallest residuals
// (the usual heuristic). Grainy rows compress best with Sub/Paeth, smooth
// ones with Up.
const STRIDE = 1 + W * 3;
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < H; y++) {
  const row = y * STRIDE;
  const up = row - STRIDE;
  let best = null;
  for (let f = 0; f <= 4; f++) {
    const line = Buffer.alloc(STRIDE);
    line[0] = f;
    let cost = 0;
    for (let i = 1; i < STRIDE; i++) {
      const v = raw[row + i];
      const a = i > 3 ? raw[row + i - 3] : 0;
      const b = y > 0 ? raw[up + i] : 0;
      const c = y > 0 && i > 3 ? raw[up + i - 3] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      const r = (v - pred + 256) & 255;
      line[i] = r;
      cost += r < 128 ? r : 256 - r;
    }
    if (!best || cost < best.cost) best = { cost, line };
  }
  best.line.copy(pixels, row);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // RGB

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../src/components/twist-messenger/hero.png", import.meta.url);
writeFileSync(out, png);
console.log(`Wrote ${out.pathname} (${W}×${H}, ${(png.length / 1024).toFixed(0)} KB)`);
