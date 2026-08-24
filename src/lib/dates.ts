import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Monday-first, matching the ISO weeks the SQL rotation uses. */
const WEEK_OPTS = { weekStartsOn: 1 as const };

/** Local calendar day key. Never use `toISOString()` here — that shifts to UTC. */
export function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function todayKey(): string {
  return dayKey(new Date());
}

/** Parse a `YYYY-MM-DD` column into a *local* midnight Date. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfWeekMon(d: Date): Date {
  return startOfWeek(d, WEEK_OPTS);
}

/**
 * ISO week key — `2026-W35`. The chore board buckets a weekly job by this, so
 * "vacuumed on Saturday" and "vacuumed on Sunday" are the same tick.
 *
 * `RRRR` rather than `yyyy` on purpose: the ISO week-numbering year, which is
 * what stops 1 January landing in week 53 of a year it does not belong to.
 */
export function weekKey(d: Date = new Date()): string {
  return format(d, "RRRR-'W'II");
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeekMon(anchor);
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

/** The 5- or 6-row grid a month view needs, padded out to whole weeks. */
export function monthGridDays(anchor: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchor), WEEK_OPTS),
    end: endOfWeek(endOfMonth(anchor), WEEK_OPTS),
  });
}

export function formatTime(d: Date): string {
  return format(d, "h:mm a");
}

export function formatDayLabel(d: Date): string {
  const today = new Date();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, 1))) return "Tomorrow";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  return format(d, "EEEE, MMM d");
}

/** Chat separators: "Today", "Yesterday", then a real date. */
export function formatChatDay(d: Date): string {
  const today = new Date();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  return format(d, "EEEE, MMMM d");
}

/** Value for a `datetime-local` input, in local time. */
export function toLocalInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export { addDays, format, isSameDay, parseISO };
