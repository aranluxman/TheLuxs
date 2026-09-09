/**
 * Draws the default launcher icons into `public/icons/`.
 *
 * These are the fallback marks — the household replaces them from inside the
 * app (the mark in the header → App icon) with a family photo. They exist
 * because an installable web app needs real PNGs at fixed paths before the
 * browser will offer the install prompt at all, and because a freshly cloned
 * repo should not ship a blank square.
 *
 * Pure Node: a tiny rasteriser plus zlib, so there is no image dependency to
 * install on a machine that only ever runs `next build`. Re-run with
 *   node scripts/generate-app-icons.mjs
 * after changing any of the constants below.
 *
 * ---------------------------------------------------------------------------
 * THE ARTWORK LIVES IN THREE PLACES AND THEY MUST AGREE
 *
 *   scripts/generate-app-icons.mjs   this file — the raster masters, for the
 *                                    Android launcher, iOS home screen and the
 *                                    maskable icon, none of which take an SVG
 *   src/app/icon.svg                 the browser tab, which is why the tab is
 *                                    sharp at any zoom or pixel ratio
 *   src/components/BrandMark.tsx     the mark in the app's own header
 *
 * `GEOMETRY` below is the single source of truth. It is expressed as fractions
 * of the artwork box (origin top-left) so the same numbers scale into any of
 * the three. Change a number here and port it to the other two in the same
 * commit, or the tab and the home screen quietly stop matching.
 * ---------------------------------------------------------------------------
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/*
 * The plate is a warm near-black with a gentle top-to-bottom lift. A flat fill
 * is what made the old mark look unfinished at 512px: at that size the eye
 * expects the plate to be a surface, not a swatch.
 *
 * PLATE_BOTTOM is the app's own `--color-ink`. The previous version used a
 * slightly different near-black (#221f1c), so the icon and the UI disagreed by
 * a few points for no reason.
 */
const PLATE_TOP = [0x2a, 0x26, 0x22];
const PLATE_BOTTOM = [0x1c, 0x19, 0x17]; // --color-ink
const CREAM = [0xf6, 0xf4, 0xf0]; // --color-canvas
const ACCENT = [0xb4, 0x53, 0x09]; // --color-accent

/** Edges are sampled this many times per axis, then averaged. Cheap AA. */
const SAMPLES = 6;

/* -------------------------------------------------------------- geometry --
 * Every coordinate is a fraction of the artwork box, origin top-left. Ported
 * verbatim into icon.svg and BrandMark.tsx — see the header.
 */
const GEOMETRY = {
  // A steeper pitch than the old mark, and a real overhang past the walls.
  // The old roof spanned 0.04–0.96 over walls at 0.15–0.85, which read as a
  // wide flat wedge rather than a roof.
  roof: { apex: [0.5, 0.09], left: [0.09, 0.47], right: [0.91, 0.47] },
  walls: { x0: 0.19, y0: 0.45, x1: 0.81, y1: 0.91, r: 0.06 },
  // Emerges from the right slope. Small, but it is the detail that stops the
  // mark reading as generated rather than drawn.
  chimney: { x0: 0.66, y0: 0.15, x1: 0.755, y1: 0.36, r: 0.022 },
  // Two lobes and a point, centred in the wall face below the eaves.
  heart: {
    r: 0.088,
    lobes: [
      [0.423, 0.615],
      [0.577, 0.615],
    ],
    point: [
      [0.345, 0.640],
      [0.655, 0.640],
      [0.5, 0.838],
    ],
  },
  /** Plate corner radius, as a fraction of the *plate*, not the artwork box. */
  plateCorner: 0.22,
};

/* ------------------------------------------------------------- predicates --
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

/* ------------------------------------------------------------- the mark --- */

const { roof, walls, chimney, heart } = GEOMETRY;

const HOUSE = union(
  triangle(roof.apex, roof.left, roof.right),
  roundedRect(walls.x0, walls.y0, walls.x1, walls.y1, walls.r),
  // Unioned with the roof, so the buried half of the chimney costs nothing.
  roundedRect(chimney.x0, chimney.y0, chimney.x1, chimney.y1, chimney.r),
);

const HEART = union(
  circle(heart.lobes[0][0], heart.lobes[0][1], heart.r),
  circle(heart.lobes[1][0], heart.lobes[1][1], heart.r),
  triangle(heart.point[0], heart.point[1], heart.point[2]),
);

/* ----------------------------------------------------------- rasteriser --- */

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param size      edge length in pixels
 * @param inset     fraction of the edge left empty around the artwork; 0.22
 *                  keeps the mark inside Android's 66% maskable safe area
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
    // The plate's gradient runs down the whole icon, so it is a property of the
    // row rather than of a sub-sample — one lerp per scanline, not per sample.
    const t = (py + 0.5) / size;
    const base = [
      lerp(PLATE_TOP[0], PLATE_BOTTOM[0], t),
      lerp(PLATE_TOP[1], PLATE_BOTTOM[1], t),
      lerp(PLATE_TOP[2], PLATE_BOTTOM[2], t),
    ];

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
  // The manifest's "any" purpose: rounded, because nothing else is going to
  // round it. The browser tab is served by src/app/icon.svg instead, so these
  // no longer have to carry a job they were never sharp enough for.
  { file: "icon-192.png", size: 192, cornerR: GEOMETRY.plateCorner, inset: 0.14 },
  { file: "icon-256.png", size: 256, cornerR: GEOMETRY.plateCorner, inset: 0.14 },
  { file: "icon-512.png", size: 512, cornerR: GEOMETRY.plateCorner, inset: 0.14 },
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
