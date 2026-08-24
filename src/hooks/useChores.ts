"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CHORES, cadenceMeta, type ChoreDefinition } from "@/lib/chores";
import { todayKey, weekKey } from "@/lib/dates";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ChoreTick } from "@/lib/types";

/**
 * How often the clock is re-checked for a period rollover. This dashboard
 * lives on a kitchen tablet that is never reloaded, so without it the board
 * would still be showing yesterday's ticks at breakfast — and, worse, ticking
 * a chore would write against yesterday's key.
 *
 * A minute is fine: the visible cost of being late is that a chore stays
 * greyed out slightly past midnight, which nobody is awake to see.
 */
const ROLLOVER_CHECK_MS = 60 * 1000;

/** The period a chore's tick is filed under, given its cadence. */
export function periodKeyFor(chore: ChoreDefinition, day: string, week: string): string {
  return cadenceMeta(chore.cadence).period === "day" ? day : week;
}

/**
 * The chore board.
 *
 * Only two periods are ever loaded — today and this week — because that is all
 * the board renders. History is in the table for anyone who wants to query it
 * later, but paging it into a wall display would be data nobody looks at.
 */
export function useChores(ready = true) {
  const [ticks, setTicks] = useState<ChoreTick[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  // Held in state rather than read during render: reading the clock in render
  // is impure, and the board must not resolve to a different period halfway
  // through painting.
  const [period, setPeriod] = useState(() => ({ day: todayKey(), week: weekKey() }));

  useEffect(() => {
    const id = setInterval(() => {
      const next = { day: todayKey(), week: weekKey() };
      setPeriod((prev) =>
        prev.day === next.day && prev.week === next.week ? prev : next,
      );
    }, ROLLOVER_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_chore_ticks")
      .select("*")
      .in("period_key", [period.day, period.week]);

    if (err) setError(err.message);
    else {
      setTicks((data ?? []) as ChoreTick[]);
      setError(null);
    }
    setLoading(false);
  }, [period.day, period.week]);

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
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-chore-ticks")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_chore_ticks" },
        (payload) => {
          const row = payload.new as ChoreTick;
          // A tick for a period this device is not showing — most likely the
          // rollover reached another phone first — is not ours to render.
          if (row.period_key !== period.day && row.period_key !== period.week) return;
          setTicks((prev) =>
            prev.some((t) => t.chore_key === row.chore_key && t.period_key === row.period_key)
              ? prev
              : [...prev, row],
          );
        },
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
  }, [ready, period.day, period.week]);

  const tickFor = useCallback(
    (chore: ChoreDefinition): ChoreTick | null => {
      const key = periodKeyFor(chore, period.day, period.week);
      return (
        ticks.find((t) => t.chore_key === chore.key && t.period_key === key) ?? null
      );
    },
    [ticks, period.day, period.week],
  );

  /**
   * Tick or untick, optimistically. One tap on a phone in a hallway is the
   * whole interaction, and a round trip's worth of lag makes the checkbox feel
   * broken — so the card commits immediately and rolls back if the write
   * fails.
   */
  const setDone = useCallback(
    async (chore: ChoreDefinition, done: boolean, byMemberId: string | null) => {
      const periodKey = periodKeyFor(chore, period.day, period.week);
      const matches = (t: ChoreTick) =>
        t.chore_key === chore.key && t.period_key === periodKey;
      const previous = ticks.find(matches) ?? null;

      if (done) {
        const optimistic: ChoreTick = {
          chore_key: chore.key,
          period_key: periodKey,
          done_by: byMemberId,
          done_at: new Date().toISOString(),
        };
        setTicks((prev) => (prev.some(matches) ? prev : [...prev, optimistic]));

        // Two people finishing at once is a primary-key collision, not an
        // error: whoever got there first keeps the credit, and `select()`
        // brings their row back so both screens agree on who that was.
        const { data, error: err } = await getSupabase()
          .from("family_chore_ticks")
          .upsert(
            { chore_key: chore.key, period_key: periodKey, done_by: byMemberId },
            { onConflict: "chore_key,period_key", ignoreDuplicates: true },
          )
          .select()
          .maybeSingle();

        if (err) {
          setTicks((prev) => prev.filter((t) => !matches(t)));
          setError(err.message);
          return;
        }
        // `ignoreDuplicates` returns nothing when someone else won the race;
        // a reload settles which of the two rows actually landed.
        if (!data) {
          await load();
          return;
        }
        setTicks((prev) => prev.map((t) => (matches(t) ? (data as ChoreTick) : t)));
        return;
      }

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
    },
    [ticks, period.day, period.week, load],
  );

  /** How much of the board is closed out right now. */
  const progress = useMemo(() => {
    const done = CHORES.filter((c) => {
      const key = periodKeyFor(c, period.day, period.week);
      return ticks.some((t) => t.chore_key === c.key && t.period_key === key);
    }).length;
    return { done, total: CHORES.length };
  }, [ticks, period.day, period.week]);

  return { ticks, tickFor, setDone, progress, period, loading, error, reload: load };
}
