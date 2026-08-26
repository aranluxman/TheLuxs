/**
 * Per-device layout preferences.
 *
 * Deliberately not in the database. These describe *this screen* — the kitchen
 * tablet wants the wide layout and to open on the calendar; a phone in a pocket
 * wants neither — so syncing them across devices would make the setting worse,
 * not better. Same reasoning as the theme, and the same storage mechanics.
 *
 * Anything that belongs to a *person* rather than a screen (name, photo,
 * colour, PIN) stays in Postgres, where the rest of the household can see it.
 */

export const START_TABS = ["calendar", "chores", "shopping", "chat"] as const;
export type StartTab = (typeof START_TABS)[number];

export const WIDTHS = ["standard", "wide"] as const;
export type Width = (typeof WIDTHS)[number];

export interface Prefs {
  /** Which tab the dashboard opens on. */
  startTab: StartTab;
  /** How much of a big screen the content is allowed to use. */
  width: Width;
}

export const DEFAULT_PREFS: Prefs = { startTab: "calendar", width: "standard" };

export const PREFS_STORAGE_KEY = "family-dashboard:prefs";

export const START_TAB_LABELS: Record<StartTab, string> = {
  calendar: "Calendar",
  chores: "Chores",
  shopping: "Shopping",
  chat: "Chat",
};

export const WIDTH_LABELS: Record<Width, string> = {
  standard: "Standard",
  wide: "Wide",
};

/** The Tailwind max-width the shell applies to its header and main column. */
export const WIDTH_CLASS: Record<Width, string> = {
  standard: "max-w-5xl",
  wide: "max-w-7xl",
};

function isStartTab(v: unknown): v is StartTab {
  return typeof v === "string" && (START_TABS as readonly string[]).includes(v);
}

function isWidth(v: unknown): v is Width {
  return typeof v === "string" && (WIDTHS as readonly string[]).includes(v);
}

/**
 * Read what is stored, field by field. A partial or hand-edited blob falls
 * back per key rather than being thrown away whole, so one unrecognised value
 * cannot silently reset the others.
 */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFS;
    const o = parsed as Record<string, unknown>;
    return {
      startTab: isStartTab(o.startTab) ? o.startTab : DEFAULT_PREFS.startTab,
      width: isWidth(o.width) ? o.width : DEFAULT_PREFS.width,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
