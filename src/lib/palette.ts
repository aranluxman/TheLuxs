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

/** A translucent wash of a member colour, for chips and event backgrounds. */
export function tint(hex: string, alpha = 0.12): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
