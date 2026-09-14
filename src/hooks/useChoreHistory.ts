"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CHORES } from "@/lib/chores";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ChoreTick } from "@/lib/types";

/**
 * How far back the history looks, and how many rows it is willing to hold.
 *
 * The board itself only ever loads the current week, because that is what the
 * leaderboard scores. History is a separate, deliberate read — you open it to
 * settle "who actually does the work around here" — so it gets its own query
 * rather than widening the one the board runs on every visit.
 */
export const HISTORY_RANGES = [
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "3 months", days: 90 },
  { id: "all", label: "All time", days: null },
] as const;

export type HistoryRangeId = (typeof HISTORY_RANGES)[number]["id"];

/** Enough for a year of a busy house; a ceiling is cheaper than a spinner. */
const MAX_ROWS = 2000;

const TITLE_BY_KEY = new Map(CHORES.map((c) => [c.key, c]));

export interface HistoryEntry {
  tick: ChoreTick;
  /** The roster entry, when the chore still exists. Retired chores keep their
   *  history — see 0008 — so this can legitimately be undefined. */
  title: string;
  icon: string;
}

export interface HistoryTotal {
  memberId: string;
  chores: number;
  points: number;
}

/**
 * Everything the house has ticked off, newest first, plus the running totals.
 *
 * Totals are computed here rather than in SQL: the same rows answer both
 * questions, an aggregate would be a second round trip, and at this volume the
 * loop is free.
 */
export function useChoreHistory(range: HistoryRangeId, ready = true) {
  const [ticks, setTicks] = useState<ChoreTick[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  const days = HISTORY_RANGES.find((r) => r.id === range)?.days ?? null;

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    let query = getSupabase()
      .from("family_chore_ticks")
      .select("*")
      .order("done_at", { ascending: false })
      .limit(MAX_ROWS);

    if (days !== null) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      query = query.gte("done_at", since);
    }

    const { data, error: err } = await query;
    if (err) setError(err.message);
    else {
      setTicks((data ?? []) as ChoreTick[]);
      setError(null);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, load]);

  const entries = useMemo<HistoryEntry[]>(
    () =>
      ticks.map((tick) => {
        const chore = TITLE_BY_KEY.get(tick.chore_key);
        return {
          tick,
          // A chore removed from the roster still shows what it was called, as
          // well as it can: the key is what the row carries.
          title: chore?.title ?? tick.chore_key.replace(/_/g, " "),
          icon: chore?.icon ?? "✔️",
        };
      }),
    [ticks],
  );

  /** Most chores first, then most points — "who did the most", in that order. */
  const totals = useMemo<HistoryTotal[]>(() => {
    const byMember = new Map<string, HistoryTotal>();
    for (const t of ticks) {
      if (!t.done_by) continue;
      const row = byMember.get(t.done_by) ?? { memberId: t.done_by, chores: 0, points: 0 };
      row.chores += 1;
      row.points += t.points ?? 1;
      byMember.set(t.done_by, row);
    }
    return [...byMember.values()].sort(
      (a, b) => b.chores - a.chores || b.points - a.points,
    );
  }, [ticks]);

  return { entries, totals, loading, error, reload: load };
}
