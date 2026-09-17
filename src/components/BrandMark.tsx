/**
 * The app's own mark — a house with a heart in it — as inline SVG.
 *
 * Inline rather than `<img src="/icons/icon-192.png">`, which is what the
 * header used to render: a 192px raster scaled down to 28 CSS pixels is soft
 * on any retina screen, and softer still on a kitchen tablet at 4K. Vector is
 * sharp at every size for free, and inline vector costs no extra request.
 *
 * Geometry is generated from GEOMETRY in scripts/generate-app-icons.mjs, at the
 * same 0.14 inset as icon-192/256/512. Keep the three copies in step: this
 * file, that script, and src/app/icon.svg.
 *
 * The colours are deliberately literal rather than theme tokens. This is a
 * brand mark: it is the same on a light kitchen tablet, in dark mode, in the
 * browser tab and on the iOS home screen, and a mark that changes with the
 * theme stops being recognisable.
 */
export function BrandMark({
  className = "",
  title = "Family Dashboard",
}: {
  className?: string;
  /** Pass null to hide it from assistive tech — for decorative placements. */
  title?: string | null;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* A flat plate reads as unfinished at 96px and above; the lift is
            small enough to be invisible at 28px, which is the point. */}
        <linearGradient id="brandmark-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2622" />
          <stop offset="1" stopColor="#1c1917" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.08" fill="url(#brandmark-plate)" />
      <g fill="#f6f4f0">
        <rect x="39.373" y="15.872" width="4.378" height="9.677" rx="1.014" />
        <polygon points="32,13.107 13.107,30.618 50.893,30.618" />
        <rect x="17.715" y="29.696" width="28.57" height="21.197" rx="2.765" />
      </g>
      <g fill="#b45309">
        <circle cx="28.452" cy="37.299" r="4.055" />
        <circle cx="35.548" cy="37.299" r="4.055" />
        <polygon points="24.858,38.451 39.142,38.451 32,47.575" />
      </g>
    </svg>
  );
}
