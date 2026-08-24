/**
 * The theme catalogue.
 *
 * A theme is a *named palette*, not a light/dark switch. Every colour in the
 * app resolves through the `--color-*` tokens in `globals.css`, so a theme is
 * defined entirely there and everything listed here is what the picker needs
 * to describe it: a name, a one-line blurb, three swatch colours and the
 * browser-chrome colour to hand to `<meta name="theme-color">`.
 *
 * `mode` is the one thing a theme carries that CSS cannot infer. It drives
 * `color-scheme` (so native scrollbars, date pickers and form controls follow
 * along) and the `dark:` variant, which is why the provider stamps a separate
 * `data-mode` attribute rather than letting components test for a theme id.
 * Adding a fifth theme then touches this file and one CSS block — no
 * component has to learn its name.
 */

export type ThemeMode = "light" | "dark";

export const THEME_IDS = ["light", "midnight", "emerald", "navy"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** What the user picked. "system" follows the OS and is the default. */
export type ThemePreference = ThemeId | "system";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  blurb: string;
  mode: ThemeMode;
  /** `[canvas, ink, accent]` — the three dots drawn in the picker. */
  swatch: [string, string, string];
  /** Matches `--color-canvas`; painted into the phone's status bar. */
  chrome: string;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "light",
    label: "Clean Light",
    blurb: "Soft white, crisp grey hairlines.",
    mode: "light",
    swatch: ["#ffffff", "#14151a", "#8a6216"],
    chrome: "#f7f7f8",
  },
  {
    id: "midnight",
    label: "Midnight Dark",
    blurb: "Deep charcoal, gold accents.",
    mode: "dark",
    swatch: ["#0e0e10", "#f4f2ee", "#d9a441"],
    chrome: "#0e0e10",
  },
  {
    id: "emerald",
    label: "Emerald Luxury",
    blurb: "Dark forest green, jade highlight.",
    mode: "dark",
    swatch: ["#08120e", "#eaf3ee", "#4ecf95"],
    chrome: "#08120e",
  },
  {
    id: "navy",
    label: "Navy Luxury",
    blurb: "Midnight navy, steel-blue accent.",
    mode: "dark",
    swatch: ["#080d18", "#e9eefb", "#7ba7f5"],
    chrome: "#080d18",
  },
];

/** What "system" resolves to, per OS setting. */
export const SYSTEM_LIGHT: ThemeId = "light";
export const SYSTEM_DARK: ThemeId = "midnight";

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value as ThemeId);
}

export function themeById(id: ThemeId): ThemeDefinition {
  // Every id in `ThemeId` is in the map by construction; the fallback exists
  // so a stale value read out of storage cannot crash the first paint.
  return BY_ID.get(id) ?? THEMES[0];
}

/** Must match the key read by the bootstrap script in `layout.tsx`. */
export const THEME_STORAGE_KEY = "family-dashboard:theme";
