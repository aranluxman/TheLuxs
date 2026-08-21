"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Chore } from "@/lib/types";

let channelSeq = 0;

/**
 * Chores due between two `YYYY-MM-DD` keys, kept live over Supabase Realtime.
 *
 * `ensureGenerated` asks Postgres to materialise any missing instances for the
 * window. It is idempotent (unique on template + period), so every device can
 * call it on load and only the first one actually writes.
 */
export function useChores(fromKey: string, toKey: string, ready = true) {
  const [chores, setChores] = useState<Chore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the realtime handler never closes over a stale window.
  const range = useRef({ fromKey, toKey });
  useEffect(() => {
    range.current = { fromKey, toKey };
  }, [fromKey, toKey]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_chores")
      .select("*")
      .gte("due_date", fromKey)
      .lte("due_date", toKey)
      .order("due_date")
      .order("created_at");

    if (err) setError(err.message);
    else {
      setChores((data ?? []) as Chore[]);
      setError(null);
    }
    setLoading(false);
  }, [fromKey, toKey]);

  const ensureGenerated = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { error: err } = await getSupabase().rpc("family_generate_chores", {
      p_from: fromKey,
      p_days: 28,
    });
    if (err) setError(err.message);
  }, [fromKey]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      await ensureGenerated();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ensureGenerated, load]);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`family-chores-${++channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "family_chores" },
        (payload) => {
          const { fromKey: lo, toKey: hi } = range.current;
          const row = (payload.new ?? payload.old) as Chore | undefined;
          if (!row) return;
          // Someone else's window may differ from ours; ignore what we do not show.
          if (row.due_date < lo || row.due_date > hi) return;

          setChores((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((c) => c.id !== row.id);
            }
            const next = payload.new as Chore;
            const idx = prev.findIndex((c) => c.id === next.id);
            if (idx === -1) {
              return [...prev, next].sort((a, b) =>
                a.due_date === b.due_date
                  ? a.created_at.localeCompare(b.created_at)
                  : a.due_date.localeCompare(b.due_date),
              );
            }
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready]);

  /** Optimistic tick; rolls back and surfaces the error if the write fails. */
  const toggleChore = useCallback(
    async (chore: Chore, done: boolean, memberId: string | null) => {
      const previous = chore;
      setChores((prev) =>
        prev.map((c) =>
          c.id === chore.id
            ? {
                ...c,
                is_completed: done,
                completed_at: done ? new Date().toISOString() : null,
                completed_by: done ? memberId : null,
              }
            : c,
        ),
      );

      const { error: err } = await getSupabase().rpc("family_set_chore_done", {
        p_chore_id: chore.id,
        p_done: done,
        p_member_id: memberId,
      });

      if (err) {
        setChores((prev) => prev.map((c) => (c.id === previous.id ? previous : c)));
        setError(err.message);
      }
    },
    [],
  );

  return { chores, loading, error, reload: load, toggleChore };
}
