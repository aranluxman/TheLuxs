/**
 * The household chore roster.
 *
 * This lives in code, not in a table, and that is the design rather than a
 * shortcut. The old chores feature had a rotation engine in SQL that generated
 * an instance row per chore per period, and it was removed in migration 0004
 * because nobody wanted a scheduler — they wanted the list off the fridge.
 * The roster changes about once a year and by conversation, not by UI.
 *
 * What *is* in the database is the tick: one row per (chore, period) saying it
 * got done and who did it. Everything else is derived from here.
 *
 * Names rather than member ids, for the same reason. A member id would tie a
 * chore to a row in `family_members` that may not exist yet on a fresh
 * database, and would make this file unreadable. `ChoresTab` resolves names to
 * profiles case-insensitively and falls back to a plain chip for anyone
 * without one — which is what keeps Rayhan on the board even though he has no
 * profile on the dashboard.
 */

export type ChoreCadence = "daily" | "weekend" | "flexible";

export interface ChoreDefinition {
  /**
   * Stable key. It is the primary key of the tick row, so renaming a chore is
   * free but changing a key orphans its history.
   */
  key: string;
  title: string;
  detail: string;
  icon: string;
  cadence: ChoreCadence;
  /** Who it belongs to, as written on the fridge. */
  assignees: string[];
  /**
   * True when any *one* of the assignees covers it in a given week, rather
   * than all of them. Changes the wording ("Aran, Rayhan or Sahana") and means
   * one tick closes the card.
   */
  rotational?: boolean;
}

export interface CadenceMeta {
  id: ChoreCadence;
  label: string;
  /** Shown under the group heading. */
  blurb: string;
  /** The badge on each card in this group. */
  badge: string;
  /** Which period key a tick in this group is filed under. */
  period: "day" | "week";
}

export const CADENCES: readonly CadenceMeta[] = [
  {
    id: "daily",
    label: "Every day",
    blurb: "Resets at midnight.",
    badge: "Daily",
    period: "day",
  },
  {
    id: "weekend",
    label: "Once a week",
    blurb: "On the weekend. Resets Monday morning.",
    badge: "Weekends",
    period: "week",
  },
  {
    id: "flexible",
    label: "Shared & flexible",
    blurb: "Whenever it needs doing — split between the people named.",
    badge: "Shared",
    period: "week",
  },
];

export const CHORES: readonly ChoreDefinition[] = [
  {
    key: "sweeping",
    title: "Sweeping",
    detail: "Kitchen, hallway and the dining area.",
    icon: "🧹",
    cadence: "daily",
    assignees: ["Sahana"],
  },
  {
    key: "vacuuming",
    title: "Vacuuming",
    detail: "Living room, stairs and the bedrooms.",
    icon: "🌀",
    cadence: "weekend",
    assignees: ["Aran", "Rayhan", "Sahana"],
    rotational: true,
  },
  {
    key: "mopping",
    title: "Mopping",
    detail: "Kitchen and the hard floors downstairs.",
    icon: "🪣",
    cadence: "weekend",
    assignees: ["Aran", "Rayhan", "Sahana"],
    rotational: true,
  },
  {
    key: "washrooms",
    title: "Cleaning the washrooms",
    detail: "Both bathrooms — sinks, mirrors, toilets, tub.",
    icon: "🚿",
    cadence: "weekend",
    assignees: ["Luxman"],
  },
  {
    key: "recycling",
    title: "Taking out the recycling",
    detail: "Blue bin and the green bin on collection night.",
    icon: "♻️",
    cadence: "flexible",
    assignees: ["Aran", "Rayhan"],
  },
  {
    key: "dishwasher",
    title: "Emptying the dishwasher",
    detail: "Unload once it has finished, put everything away.",
    icon: "🍽️",
    cadence: "flexible",
    assignees: ["Sukhi", "Aran"],
  },
];

const CADENCE_BY_ID = new Map(CADENCES.map((c) => [c.id, c]));

export function cadenceMeta(id: ChoreCadence): CadenceMeta {
  return CADENCE_BY_ID.get(id) ?? CADENCES[0];
}

/** "Sahana", "Aran, Rayhan or Sahana", "Sukhi & Aran". */
export function assigneeSentence(chore: ChoreDefinition): string {
  const names = chore.assignees;
  if (names.length === 1) return names[0];
  const head = names.slice(0, -1).join(", ");
  return `${head} ${chore.rotational ? "or" : "&"} ${names[names.length - 1]}`;
}

/** Every name on the board, in roster order, without duplicates. */
export const CHORE_PEOPLE: readonly string[] = [
  ...new Set(CHORES.flatMap((c) => c.assignees)),
];
