/**
 * The household chore list.
 *
 * Chores are no longer assigned to anybody. Every job on this board is open to
 * whoever gets to it, and finishing one earns that person a point — which is
 * what turns the board from a rota into a scoreboard. Who did what is recorded
 * at the moment it is ticked, by tapping a face on the card, rather than
 * decided in advance here.
 *
 * That is the whole reason this file no longer carries names. A fixed roster
 * and a points race are different products: with assignees, "Sahana's point"
 * is a foregone conclusion and the score says nothing; without them, the score
 * is the only record of who actually did the work.
 *
 * The list itself lives in code rather than a table because it changes about
 * once a year and by conversation, not through a UI. What the database holds
 * is the tick — see `supabase/migrations/0008_chore_board.sql`.
 */

export type ChoreCadence = "daily" | "weekend";

export interface ChoreDefinition {
  /**
   * Stable key. It is half the primary key of the tick row, so renaming a
   * chore is free but changing a key orphans its history — and, because the
   * period key's shape follows the cadence, moving a chore between cadences
   * orphans it too.
   */
  key: string;
  title: string;
  detail: string;
  icon: string;
  cadence: ChoreCadence;
}

export interface CadenceMeta {
  id: ChoreCadence;
  label: string;
  /** Shown under the group heading. */
  blurb: string;
  /** The badge on each card in this group. */
  badge: string;
  /**
   * Which period key a tick in this group is filed under — a local day, or an
   * ISO week. This is what makes a daily chore worth a point every day and a
   * weekend one worth a point a week, with no scheduler involved.
   */
  period: "day" | "week";
}

export const CADENCES: readonly CadenceMeta[] = [
  {
    id: "daily",
    label: "Every day",
    blurb: "Worth a point each, every day. Resets at midnight.",
    badge: "Daily",
    period: "day",
  },
  {
    id: "weekend",
    label: "Weekends",
    blurb: "Once a week, on the weekend. Resets Monday morning.",
    badge: "Weekend",
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
  },
  {
    key: "wiping_table",
    title: "Wiping the table",
    detail: "After dinner — table and the counters.",
    icon: "🧽",
    cadence: "daily",
  },
  {
    key: "unloading_dishwasher",
    title: "Unloading the dishwasher",
    detail: "Once it has finished, put everything away.",
    icon: "🍽️",
    cadence: "daily",
  },
  {
    key: "washing_dishes",
    title: "Washing the dishes",
    detail: "Anything that does not go in the dishwasher.",
    icon: "🫧",
    cadence: "daily",
  },
  {
    key: "mopping",
    title: "Mopping",
    detail: "Kitchen and the hard floors downstairs.",
    icon: "🪣",
    cadence: "weekend",
  },
  {
    key: "vacuuming",
    title: "Vacuuming",
    detail: "Living room, stairs and the bedrooms.",
    icon: "🌀",
    cadence: "weekend",
  },
  {
    key: "washrooms",
    title: "Cleaning the washrooms",
    detail: "Both bathrooms — sinks, mirrors, toilets, tub.",
    icon: "🚿",
    cadence: "weekend",
  },
];

const CADENCE_BY_ID = new Map(CADENCES.map((c) => [c.id, c]));

export function cadenceMeta(id: ChoreCadence): CadenceMeta {
  return CADENCE_BY_ID.get(id) ?? CADENCES[0];
}

/**
 * The most points the house can put on the board in one week: every daily
 * chore on all seven days, plus every weekend chore once. Shown next to the
 * leaderboard so a score has something to be a fraction of.
 */
export const POINTS_AVAILABLE_PER_WEEK = CHORES.reduce(
  (total, chore) => total + (cadenceMeta(chore.cadence).period === "day" ? 7 : 1),
  0,
);
