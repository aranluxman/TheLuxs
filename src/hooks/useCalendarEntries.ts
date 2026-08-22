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

/** Per-member schedule items that overlay the shared calendar. */
export function useCalendarEntries(ready = true) {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_calendar_entries")
      .select("*")
      .order("start_time");

    if (err) setError(err.message);
    else {
      setEntries((data ?? []) as CalendarEntry[]);
      setError(null);
    }
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
