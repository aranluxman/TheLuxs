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

/**
 * The seven `YYYY-MM-DD` keys of the week containing `anchor`, Monday first.
 *
 * The chore board loads exactly these plus the week key: a daily chore's ticks
 * are filed per day, so a week's worth of points cannot be read without naming
 * all seven days.
 */
export function weekDayKeys(anchor: Date = new Date()): string[] {
  return weekDays(anchor).map(dayKey);
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

/**
 * Chat separators: "Today", "Yesterday", then a real date.
 *
 * Relative labels stop after two days on purpose. "3 days ago" needs arithmetic
 * to place, where a weekday and a date can be read straight off — and this
 * thread is never purged, so most of what a reader scrolls past is old.
 *
 * The year appears only when it is not the current one. A chat that keeps its
 * whole history will eventually show two "Tuesday, September 8" separators a
 * year apart, and there would be nothing on screen to tell them apart.
 */
export function formatChatDay(d: Date): string {
  const today = new Date();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  return d.getFullYear() === today.getFullYear()
    ? format(d, "EEEE, MMMM d")
    : format(d, "EEEE, MMMM d, yyyy");
}

/** Value for a `datetime-local` input, in local time. */
export function toLocalInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export { addDays, format, isSameDay, parseISO };
