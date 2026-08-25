"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CHORES, cadenceMeta, type ChoreDefinition } from "@/lib/chores";
import { todayKey, weekDayKeys, weekKey } from "@/lib/dates";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ChoreTick } from "@/lib/types";

/**
 * How often the clock is re-checked for a period rollover. This dashboard
 * lives on a kitchen tablet that is never reloaded, so without it the board
 * would still be showing yesterday's ticks at breakfast — and, worse, ticking
 * a chore would score it against yesterday.
 *
 * A minute is fine: the visible cost of being late is that a chore stays
 * ticked slightly past midnight, which nobody is awake to see.
 */
const ROLLOVER_CHECK_MS = 60 * 1000;

/** Everything the board needs to know about "when is now". */
interface Period {
  /** Today, for the daily chores on screen. */
  day: string;
  /** This ISO week, for the weekend chores. */
  week: string;
  /** All seven days of this week — the scoring window. */
  days: string[];
}

function currentPeriod(): Period {
  return { day: todayKey(), week: weekKey(), days: weekDayKeys() };
}

/** The period a chore's tick is filed under, given its cadence. */
export function periodKeyFor(chore: ChoreDefinition, period: Period): string {
  return cadenceMeta(chore.cadence).period === "day" ? period.day : period.week;
}

/**
 * The chore board and this week's scores.
 *
 * A whole week of ticks is loaded, not just today's, because the leaderboard
 * is the point of the feature and a daily chore's ticks are filed one per day
 * — Monday's sweep and Friday's sweep are different rows. Eight period keys
 * (seven days plus the week) cover every point available, and that is still a
 * tiny query: the ceiling is one row per chore per day.
 */
export function useChores(ready = true) {
  const [ticks, setTicks] = useState<ChoreTick[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  // Held in state rather than read during render: reading the clock in render
  // is impure, and the board must not resolve to a different day halfway
  // through painting.
  const [period, setPeriod] = useState<Period>(currentPeriod);

  useEffect(() => {
    const id = setInterval(() => {
      const next = currentPeriod();
      setPeriod((prev) =>
        prev.day === next.day && prev.week === next.week ? prev : next,
      );
    }, ROLLOVER_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  // One string, so the effects below depend on a primitive rather than on an
  // array that is a fresh object every time the clock is read.
  const windowKeys = useMemo(
    () => [...period.days, period.week],
    [period.days, period.week],
  );
  const windowId = windowKeys.join(",");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_chore_ticks")
      .select("*")
      .in("period_key", windowId.split(","));

    if (err) setError(err.message);
    else {
      setTicks((data ?? []) as ChoreTick[]);
      setError(null);
    }
    setLoading(false);
  }, [windowId]);

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

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const inWindow = new Set(windowId.split(","));
    const supabase = getSupabase();

    const upsertLocal = (row: ChoreTick) => {
      // A tick for a period this device is not showing — most likely the
      // rollover reached another phone first — is not ours to render.
      if (!inWindow.has(row.period_key)) return;
      setTicks((prev) => {
        const i = prev.findIndex(
          (t) => t.chore_key === row.chore_key && t.period_key === row.period_key,
        );
        if (i === -1) return [...prev, row];
        const next = [...prev];
        next[i] = row;
        return next;
      });
    };

    const channel = supabase
      .channel("family-chore-ticks")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_chore_ticks" },
        (payload) => upsertLocal(payload.new as ChoreTick),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_chore_ticks" },
        // A chore changing hands. Migration 0010 allows exactly this update,
        // and it moves a point from one person to another — so the leaderboard
        // has to see it, not just the card.
        (payload) => upsertLocal(payload.new as ChoreTick),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_chore_ticks" },
        (payload) => {
          // Needs FULL replica identity, which migration 0008 sets.
          const row = payload.old as Partial<ChoreTick>;
          if (!row.chore_key || !row.period_key) return;
          setTicks((prev) =>
            prev.filter(
              (t) => !(t.chore_key === row.chore_key && t.period_key === row.period_key),
            ),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, windowId]);

  /** The tick on a chore's *current* period, or null if nobody has done it. */
  const tickFor = useCallback(
    (chore: ChoreDefinition): ChoreTick | null => {
      const key = periodKeyFor(chore, period);
      return ticks.find((t) => t.chore_key === chore.key && t.period_key === key) ?? null;
    },
    [ticks, period],
  );

  /**
   * Record who did a chore, or clear it with `null`.
   *
   * Written optimistically because the whole interaction is one tap in
   * passing, and a round trip's worth of lag makes the card feel broken.
   *
   * Claiming and re-attributing are the same statement — an upsert on the
   * primary key. That matters for the second case: as a delete plus an insert,
   * a correction that fails halfway loses the tick entirely and takes a point
   * off somebody who earned it, whereas `on conflict do update` cannot
   * half-happen.
   */
  const setDoneBy = useCallback(
    async (chore: ChoreDefinition, memberId: string | null) => {
      const periodKey = periodKeyFor(chore, period);
      const matches = (t: ChoreTick) =>
        t.chore_key === chore.key && t.period_key === periodKey;
      const previous = ticks.find(matches) ?? null;

      if (memberId === null) {
        setTicks((prev) => prev.filter((t) => !matches(t)));

        const { error: err } = await getSupabase()
          .from("family_chore_ticks")
          .delete()
          .eq("chore_key", chore.key)
          .eq("period_key", periodKey);

        if (err) {
          if (previous) setTicks((prev) => (prev.some(matches) ? prev : [...prev, previous]));
          setError(err.message);
        }
        return;
      }

      const optimistic: ChoreTick = {
        chore_key: chore.key,
        period_key: periodKey,
        done_by: memberId,
        done_at: new Date().toISOString(),
      };
      setTicks((prev) =>
        prev.some(matches) ? prev.map((t) => (matches(t) ? optimistic : t)) : [...prev, optimistic],
      );

      const { data, error: err } = await getSupabase()
        .from("family_chore_ticks")
        .upsert(
          { chore_key: chore.key, period_key: periodKey, done_by: memberId, done_at: optimistic.done_at },
          { onConflict: "chore_key,period_key" },
        )
        .select()
        .single();

      if (err) {
        setTicks((prev) => {
          const without = prev.filter((t) => !matches(t));
          return previous ? [...without, previous] : without;
        });
        setError(err.message);
        return;
      }
      setTicks((prev) => prev.map((t) => (matches(t) ? (data as ChoreTick) : t)));
    },
    [ticks, period],
  );

  /**
   * Points per member for this week — one per chore finished, whichever day it
   * was and whichever chore it was. Ticks whose owner has since been removed
   * from the family carry a null `done_by` and score for nobody.
   */
  const scores = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of ticks) {
      if (t.done_by) out[t.done_by] = (out[t.done_by] ?? 0) + 1;
    }
    return out;
  }, [ticks]);

  /** How much of what is on screen right now is closed out. */
  const progress = useMemo(() => {
    const done = CHORES.filter((c) => {
      const key = periodKeyFor(c, period);
      return ticks.some((t) => t.chore_key === c.key && t.period_key === key);
    }).length;
    return { done, total: CHORES.length };
  }, [ticks, period]);

  return { ticks, tickFor, setDoneBy, scores, progress, period, loading, error, reload: load };
}
