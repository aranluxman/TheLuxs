/**
 * Draws the default launcher icons into `public/icons/`.
 *
 * These are the fallback marks — the household replaces them from inside the
 * app (Settings → app icon) with a family photo. They exist because an
 * installable web app needs real PNGs at fixed paths before the browser will
 * offer the install prompt at all, and because a freshly cloned repo should
 * not ship a blank square.
 *
 * Pure Node: a tiny rasteriser plus zlib, so there is no image dependency to
 * install on a machine that only ever runs `next build`. Re-run with
 *   node scripts/generate-app-icons.mjs
 * after changing any of the constants below.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const INK = [0x22, 0x1f, 0x1c]; // warm near-black, the app's dark canvas
const CREAM = [0xf6, 0xf4, 0xf0]; // --color-canvas
const ACCENT = [0xb4, 0x53, 0x09]; // --color-accent

/** Edges are sampled this many times per axis, then averaged. Cheap AA. */
const SAMPLES = 4;

/* ------------------------------------------------------------- geometry --
 * Every shape is a predicate over the unit square, so the same drawing code
 * renders at any pixel size and the artwork can be scaled into the safe area
 * of a maskable icon without being redrawn.
 */

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    // Clamp to the inner rectangle: the distance to it is zero except in the
    // four corner squares, where it becomes the corner circle test.
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };
}

function triangle([ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

const union =
  (...shapes) =>
  (x, y) =>
    shapes.some((s) => s(x, y));

/* ------------------------------------------------------------- the mark --
 * A house with a heart in it, drawn in the app's own palette. Coordinates are
 * fractions of the artwork box, origin top-left.
 */

const ROOF = triangle([0.5, 0.08], [0.04, 0.45], [0.96, 0.45]);
const WALLS = roundedRect(0.15, 0.42, 0.85, 0.93, 0.07);
const HOUSE = union(ROOF, WALLS);

const HEART = union(
  circle(0.427, 0.6, 0.083),
  circle(0.573, 0.6, 0.083),
  triangle([0.345, 0.618], [0.655, 0.618], [0.5, 0.82]),
);

/* ----------------------------------------------------------- rasteriser --- */

/**
 * @param size      edge length in pixels
 * @param inset     fraction of the edge left empty around the artwork; 0.2 keeps
 *                  the mark inside Android's 66% maskable safe area
 * @param cornerR   corner radius as a fraction of the edge; 0 = full bleed,
 *                  which is what iOS and maskable icons want (they mask it
 *                  themselves, and a pre-rounded icon shows dark corners)
 */
function render(size, { inset = 0.16, cornerR = 0 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const plate = cornerR > 0 ? roundedRect(0, 0, 1, 1, cornerR) : rect(0, 0, 1, 1);

  // Artwork occupies the inset box; map a pixel back into artwork space.
  const span = 1 - inset * 2;
  const toArt = (u) => (u - inset) / span;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let plateHits = 0;
      let houseHits = 0;
      let heartHits = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (px + (sx + 0.5) / SAMPLES) / size;
          const v = (py + (sy + 0.5) / SAMPLES) / size;
          if (!plate(u, v)) continue;
          plateHits++;
          const ax = toArt(u);
          const ay = toArt(v);
          if (ax < 0 || ax > 1 || ay < 0 || ay > 1) continue;
          if (HEART(ax, ay)) heartHits++;
          else if (HOUSE(ax, ay)) houseHits++;
        }
      }

      const total = SAMPLES * SAMPLES;
      // Composite back-to-front in coverage space so edges blend instead of
      // stair-stepping. The heart sits on the house, the house on the plate.
      const alpha = plateHits / total;
      const base = INK;
      const houseMix = houseHits / total;
      const heartMix = heartHits / total;
      const covered = houseMix + heartMix;

      const channel = (i) =>
        Math.round(
          base[i] * (1 - covered) + CREAM[i] * houseMix + ACCENT[i] * heartMix,
        );

      const o = (py * size + px) * 4;
      pixels[o] = channel(0);
      pixels[o + 1] = channel(1);
      pixels[o + 2] = channel(2);
      pixels[o + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/* ------------------------------------------------------------ PNG output --
 * Minimal encoder: one IHDR, one deflated IDAT of filter-0 scanlines, IEND.
 */

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- targets --- */

const TARGETS = [
  // Browser tab and the manifest's "any" purpose: rounded, because nothing
  // else is going to round it.
  { file: "icon-192.png", size: 192, cornerR: 0.22, inset: 0.14 },
  { file: "icon-512.png", size: 512, cornerR: 0.22, inset: 0.14 },
  // Android adaptive icons crop to a circle or a squircle, so the plate is
  // full-bleed and the mark stays well inside the safe area.
  { file: "icon-maskable-512.png", size: 512, cornerR: 0, inset: 0.22 },
  // iOS applies its own mask and dislikes transparency.
  { file: "apple-touch-icon.png", size: 180, cornerR: 0, inset: 0.16 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, cornerR, inset } of TARGETS) {
  const png = encodePng(size, render(size, { inset, cornerR }));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
