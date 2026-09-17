/**
 * Per-device preferences.
 *
 * Deliberately not in the database. These describe *this screen* — the kitchen
 * tablet wants the wide layout, big text and the weather on the wall; a phone
 * in a pocket wants none of that — so syncing them across devices would make
 * the settings worse, not better. Same reasoning as the theme, and the same
 * storage mechanics.
 *
 * Anything that belongs to a *person* rather than a screen (name, photo,
 * colour, PIN) stays in Postgres, where the rest of the household can see it.
 *
 * Every field is read back one at a time by `parsePrefs`, so adding one here
 * is safe against blobs written by an older version: an absent key falls back
 * to its default rather than resetting the ones beside it.
 */

export const START_TABS = ["calendar", "todos", "chores", "shopping", "chat"] as const;
export type StartTab = (typeof START_TABS)[number];

export const WIDTHS = ["standard", "wide"] as const;
export type Width = (typeof WIDTHS)[number];

/** Whole-app text scale. A wall tablet is read from across the kitchen. */
export const TEXT_SIZES = ["small", "standard", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const UNITS = ["metric", "imperial"] as const;
export type Units = (typeof UNITS)[number];

/** How the calendar opens: the agenda list, or a month/week grid. */
export const CALENDAR_VIEWS = ["list", "grid"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * Where the weather is for.
 *
 * A coordinate and a label rather than a place name: Open-Meteo's forecast
 * endpoint takes latitude and longitude, and resolving a name would mean a
 * second service and a second thing to be down. The label is only ever shown.
 */
export interface WeatherPlace {
  label: string;
  lat: number;
  lon: number;
}

/** Home. The house this dashboard was built for is in Markham, Ontario. */
export const DEFAULT_PLACE: WeatherPlace = {
  label: "Markham, ON",
  lat: 43.8561,
  lon: -79.337,
};

export interface Prefs {
  /** Which tab the dashboard opens on. */
  startTab: StartTab;
  /** How much of a big screen the content is allowed to use. */
  width: Width;
  textSize: TextSize;
  /** Celsius and kilometres, or Fahrenheit and miles. */
  units: Units;
  /** The weather panel on the calendar tab. */
  showWeather: boolean;
  /** The photo wall on the calendar tab. */
  showPhotos: boolean;
  /** The quote of the day on the Today card. */
  showQuote: boolean;
  /** Which calendar view is on screen when the tab opens. */
  calendarView: CalendarView;
  /** Desktop notifications for new chat messages. */
  notifyMessages: boolean;
  /** A sound with the notification. Off by default — a kitchen is loud enough. */
  notifySound: boolean;
  /** Where the weather panel is reporting from. */
  weatherPlace: WeatherPlace;
}

export const DEFAULT_PREFS: Prefs = {
  startTab: "calendar",
  width: "standard",
  textSize: "standard",
  units: "metric",
  showWeather: true,
  showPhotos: true,
  showQuote: true,
  calendarView: "list",
  notifyMessages: false,
  notifySound: false,
  weatherPlace: DEFAULT_PLACE,
};

export const PREFS_STORAGE_KEY = "family-dashboard:prefs";

export const START_TAB_LABELS: Record<StartTab, string> = {
  calendar: "Calendar",
  todos: "To Do's",
  chores: "Chores",
  shopping: "Shopping",
  chat: "Chat",
};

export const WIDTH_LABELS: Record<Width, string> = {
  standard: "Standard",
  wide: "Wide",
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: "Small",
  standard: "Standard",
  large: "Large",
};

export const UNITS_LABELS: Record<Units, string> = {
  metric: "°C · km",
  imperial: "°F · mi",
};

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  list: "List",
  grid: "Grid",
};

/** The Tailwind max-width the shell applies to its header and main column. */
export const WIDTH_CLASS: Record<Width, string> = {
  standard: "max-w-5xl",
  wide: "max-w-7xl",
};

/**
 * The root font size each scale sets. Everything in the app is sized in `rem`
 * through Tailwind, so one number here moves the whole interface — which is
 * why this is a scale rather than a per-component setting.
 */
export const TEXT_SIZE_ROOT_PX: Record<TextSize, number> = {
  small: 15,
  standard: 16,
  large: 18,
};

function oneOf<T extends string>(options: readonly T[]) {
  return (v: unknown): v is T => typeof v === "string" && (options as readonly string[]).includes(v);
}

const isStartTab = oneOf(START_TABS);
const isWidth = oneOf(WIDTHS);
const isTextSize = oneOf(TEXT_SIZES);
const isUnits = oneOf(UNITS);
const isCalendarView = oneOf(CALENDAR_VIEWS);

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** A coordinate is only usable if it is a real one — a half-written blob is not. */
function place(v: unknown): WeatherPlace | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lat !== "number" || typeof o.lon !== "number") return null;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
  if (Math.abs(o.lat) > 90 || Math.abs(o.lon) > 180) return null;
  return {
    label: typeof o.label === "string" && o.label.trim() ? o.label.slice(0, 60) : "Home",
    lat: o.lat,
    lon: o.lon,
  };
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
      textSize: isTextSize(o.textSize) ? o.textSize : DEFAULT_PREFS.textSize,
      units: isUnits(o.units) ? o.units : DEFAULT_PREFS.units,
      showWeather: bool(o.showWeather, DEFAULT_PREFS.showWeather),
      showPhotos: bool(o.showPhotos, DEFAULT_PREFS.showPhotos),
      showQuote: bool(o.showQuote, DEFAULT_PREFS.showQuote),
      calendarView: isCalendarView(o.calendarView)
        ? o.calendarView
        : DEFAULT_PREFS.calendarView,
      notifyMessages: bool(o.notifyMessages, DEFAULT_PREFS.notifyMessages),
      notifySound: bool(o.notifySound, DEFAULT_PREFS.notifySound),
      weatherPlace: place(o.weatherPlace) ?? DEFAULT_PREFS.weatherPlace,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
