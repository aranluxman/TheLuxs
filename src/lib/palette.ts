/** Distinct, readable-on-white accents offered when setting up the family. */
export const MEMBER_COLORS = [
  "#e11d48", // rose
  "#0891b2", // cyan
  "#7c3aed", // violet
  "#ea580c", // orange
  "#16a34a", // green
  "#2563eb", // blue
  "#db2777", // pink
  "#ca8a04", // amber
] as const;

export const MEMBER_EMOJI = [
  "🦊", "🐻", "🐼", "🦁", "🐸", "🐧", "🦉", "🐨", "🐯", "🦄", "🐙", "🐢",
] as const;

export const CALENDAR_CATEGORIES = [
  "general",
  "school",
  "work",
  "sports",
  "appointment",
  "social",
] as const;

export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

/**
 * Per-category glyph and hue for calendar entries.
 *
 * The member colour already claims the left edge of an agenda row, so category
 * cannot also be a colour bar without the two competing. It gets the icon slot
 * instead — shape is the faster read at a glance anyway, and it survives being
 * looked at by someone who cannot distinguish the hues.
 */
export const CATEGORY_STYLE: Record<
  string,
  { icon: string; label: string; hue: string }
> = {
  general:     { icon: "•",  label: "General",     hue: "#78716c" },
  school:      { icon: "✏️", label: "School",      hue: "#2563eb" },
  work:        { icon: "💼", label: "Work",        hue: "#0f766e" },
  sports:      { icon: "⚽", label: "Sports",      hue: "#16a34a" },
  appointment: { icon: "🩺", label: "Appointment", hue: "#db2777" },
  social:      { icon: "🎉", label: "Social",      hue: "#7c3aed" },
};

/** Falls back to `general` so an unknown category still renders sensibly. */
export function categoryStyle(category: string | null | undefined) {
  return CATEGORY_STYLE[category ?? "general"] ?? CATEGORY_STYLE.general;
}

/** A translucent wash of a member colour, for chips and event backgrounds. */
export function tint(hex: string, alpha = 0.12): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
