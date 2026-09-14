"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHORES,
  cadenceMeta,
  chorePoints,
  type ChoreDefinition,
} from "@/lib/chores";
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
 * tiny query: the ceiling is a row per chore per person per day.
 *
 * Since migration 0016 a chore can carry several sign-ups in one period —
 * the dishes get washed three times a day and rarely by the same person — so
 * everything here works in terms of *a list* of ticks per chore rather than
 * the single tick the first version assumed.
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
        const i = prev.findIndex((t) => t.id === row.id);
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
        // A single-owner chore changing hands. It moves points from one person
        // to another, so the leaderboard has to see it, not just the card.
        (payload) => upsertLocal(payload.new as ChoreTick),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_chore_ticks" },
        (payload) => {
          // Needs FULL replica identity, which migration 0008 sets.
          const row = payload.old as Partial<ChoreTick>;
          if (!row.id) return;
          setTicks((prev) => prev.filter((t) => t.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, windowId]);

  /** Everyone signed up for a chore in its *current* period, oldest first. */
  const ticksFor = useCallback(
    (chore: ChoreDefinition): ChoreTick[] => {
      const key = periodKeyFor(chore, period);
      return ticks
        .filter((t) => t.chore_key === chore.key && t.period_key === key)
        .sort((a, b) => a.done_at.localeCompare(b.done_at));
    },
    [ticks, period],
  );

  /**
   * Sign a person up for a chore, or take their name off it.
   *
   * Three shapes, all of them one statement:
   *
   *   already signed up      delete their row — tapping your own face undoes it
   *   multi-signup chore     insert another row; everyone who helped scores
   *   single-owner chore     hand it over: update `done_by` on the row that is
   *                          already there, rather than delete-then-insert. A
   *                          two-statement swap that fails halfway loses the
   *                          tick and takes points off somebody who earned them.
   *
   * Written optimistically, because the whole interaction is one tap in
   * passing and a round trip's worth of lag makes the card feel broken. The id
   * of an optimistic row is a placeholder until the insert comes back with the
   * real one; the reconcile below swaps it, and Realtime's echo is matched on
   * id so it cannot double up.
   */
  const toggleMember = useCallback(
    async (chore: ChoreDefinition, memberId: string) => {
      const periodKey = periodKeyFor(chore, period);
      const inPeriod = (t: ChoreTick) =>
        t.chore_key === chore.key && t.period_key === periodKey;

      const current = ticks.filter(inPeriod);
      const mine = current.find((t) => t.done_by === memberId) ?? null;

      /* ------------------------------------------------ taking a name off */
      if (mine) {
        setTicks((prev) => prev.filter((t) => t.id !== mine.id));
        const { error: err } = await getSupabase()
          .from("family_chore_ticks")
          .delete()
          .eq("id", mine.id);
        if (err) {
          setTicks((prev) => (prev.some((t) => t.id === mine.id) ? prev : [...prev, mine]));
          setError(err.message);
        }
        return;
      }

      /* ------------------------------------- handing over a one-owner chore */
      const holder = chore.multi ? null : (current[0] ?? null);
      if (holder) {
        const doneAt = new Date().toISOString();
        setTicks((prev) =>
          prev.map((t) =>
            t.id === holder.id ? { ...t, done_by: memberId, done_at: doneAt } : t,
          ),
        );
        const { data, error: err } = await getSupabase()
          .from("family_chore_ticks")
          .update({ done_by: memberId, done_at: doneAt })
          .eq("id", holder.id)
          .select()
          .maybeSingle();

        if (err || !data) {
          setTicks((prev) => prev.map((t) => (t.id === holder.id ? holder : t)));
          setError(err?.message ?? "That did not save.");
          return;
        }
        setTicks((prev) => prev.map((t) => (t.id === holder.id ? (data as ChoreTick) : t)));
        return;
      }

      /* --------------------------------------------------- a fresh sign-up */
      const pending = `pending:${chore.key}:${periodKey}:${memberId}`;
      const optimistic: ChoreTick = {
        id: pending,
        chore_key: chore.key,
        period_key: periodKey,
        done_by: memberId,
        done_at: new Date().toISOString(),
        points: chorePoints(chore),
      };
      setTicks((prev) => [...prev, optimistic]);

      const { data, error: err } = await getSupabase()
        .from("family_chore_ticks")
        .insert({
          chore_key: chore.key,
          period_key: periodKey,
          done_by: memberId,
          done_at: optimistic.done_at,
          points: optimistic.points,
        })
        .select()
        .single();

      if (err || !data) {
        setTicks((prev) => prev.filter((t) => t.id !== pending));
        setError(err?.message ?? "That did not save.");
        return;
      }
      const saved = data as ChoreTick;
      setTicks((prev) => {
        // Realtime may have delivered the real row already, in which case the
        // placeholder is simply dropped rather than replaced.
        const withoutPending = prev.filter((t) => t.id !== pending);
        return withoutPending.some((t) => t.id === saved.id)
          ? withoutPending
          : [...withoutPending, saved];
      });
    },
    [ticks, period],
  );

  /**
   * Points per member for this week, weighted: a tick is worth whatever was
   * stamped on it, so mopping counts double and a re-worded roster never
   * re-scores the past. Ticks whose owner has since left the family carry a
   * null `done_by` and score for nobody.
   */
  const scores = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of ticks) {
      if (t.done_by) out[t.done_by] = (out[t.done_by] ?? 0) + (t.points ?? 1);
    }
    return out;
  }, [ticks]);

  /** How much of what is on screen right now has at least one name on it. */
  const progress = useMemo(() => {
    const done = CHORES.filter((c) => {
      const key = periodKeyFor(c, period);
      return ticks.some((t) => t.chore_key === c.key && t.period_key === key);
    }).length;
    return { done, total: CHORES.length };
  }, [ticks, period]);

  return { ticks, ticksFor, toggleMember, scores, progress, period, loading, error, reload: load };
}
