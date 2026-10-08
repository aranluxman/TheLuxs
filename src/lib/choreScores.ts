import type { ChoreTick } from "./types";

/** Calendar-year boundaries in the household device's local timezone. */
export function choreYearWindow(now: Date = new Date()) {
  const year = now.getFullYear();
  return {
    year,
    start: new Date(year, 0, 1).toISOString(),
    end: new Date(year + 1, 0, 1).toISOString(),
  };
}

/** Prior-year ticks can still mark a weekend card, but never score this year. */
export function annualChoreScores(ticks: ChoreTick[], start: string, end: string) {
  const scores: Record<string, number> = {};
  const from = Date.parse(start);
  const until = Date.parse(end);
  for (const tick of ticks) {
    const doneAt = Date.parse(tick.done_at);
    if (tick.done_by && doneAt >= from && doneAt < until) {
      scores[tick.done_by] = (scores[tick.done_by] ?? 0) + (tick.points ?? 1);
    }
  }
  return scores;
}
