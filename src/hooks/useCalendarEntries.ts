"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { CalendarEntry } from "@/lib/types";

export interface NewCalendarEntryInput {
  member_id: string | null;
  title: string;
  start_time: string;
  end_time: string | null;
  category: string;
}

/** Supabase's default row cap per request. */
const PAGE_SIZE = 1000;

/** Per-member schedule items that overlay the shared calendar. */
export function useCalendarEntries(ready = true) {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    // Supabase hands back at most 1000 rows per request, and a few synced
    // calendars pass that quickly — read in pages so the tail isn't dropped.
    const all: CalendarEntry[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error: err } = await getSupabase()
        .from("family_calendar_entries")
        .select("*")
        .order("start_time")
        .order("id") // a stable tiebreak, or rows can repeat or vanish across pages
        .range(offset, offset + PAGE_SIZE - 1);

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      all.push(...((data ?? []) as CalendarEntry[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    setEntries(all);
    setError(null);
    setLoading(false);
  }, []);

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

  const createEntry = useCallback(
    async (input: NewCalendarEntryInput) => {
      const { error: err } = await getSupabase()
        .from("family_calendar_entries")
        .insert(input);
      if (err) {
        setError(err.message);
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const deleteEntry = useCallback(async (id: string) => {
    const { error: err } = await getSupabase()
      .from("family_calendar_entries")
      .delete()
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { entries, loading, error, createEntry, deleteEntry, reload: load };
}
