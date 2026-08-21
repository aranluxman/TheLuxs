"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { LookingForward, Quote } from "@/lib/types";

/** Days since the epoch — the same everywhere, so the house shares a quote. */
function dayNumber(d = new Date()): number {
  return Math.floor(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000,
  );
}

export function useDailyExtras(ready = true) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [notes, setNotes] = useState<LookingForward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    const [q, n] = await Promise.all([
      supabase.from("family_quotes").select("*").eq("is_active", true).order("created_at"),
      supabase.from("family_looking_forward").select("*"),
    ]);

    if (q.error || n.error) {
      setError((q.error ?? n.error)!.message);
    } else {
      setQuotes((q.data ?? []) as Quote[]);
      setNotes((n.data ?? []) as LookingForward[]);
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

  // Rotates once a day and never repeats until the list is exhausted.
  const quoteOfTheDay = useMemo(
    () => (quotes.length ? quotes[dayNumber() % quotes.length] : null),
    [quotes],
  );

  const setLookingForward = useCallback(
    async (memberId: string, note: string, targetDate: string | null) => {
      const supabase = getSupabase();
      const trimmed = note.trim();

      if (!trimmed) {
        setNotes((prev) => prev.filter((n) => n.member_id !== memberId));
        const { error: err } = await supabase
          .from("family_looking_forward")
          .delete()
          .eq("member_id", memberId);
        if (err) setError(err.message);
        return;
      }

      const row: LookingForward = {
        member_id: memberId,
        note: trimmed.slice(0, 160),
        target_date: targetDate,
        updated_at: new Date().toISOString(),
      };
      setNotes((prev) => [...prev.filter((n) => n.member_id !== memberId), row]);

      const { error: err } = await supabase
        .from("family_looking_forward")
        .upsert(row, { onConflict: "member_id" });
      if (err) {
        setError(err.message);
        await load();
      }
    },
    [load],
  );

  const noteFor = useCallback(
    (memberId: string) => notes.find((n) => n.member_id === memberId) ?? null,
    [notes],
  );

  return { quoteOfTheDay, notes, noteFor, setLookingForward, loading, error };
}
