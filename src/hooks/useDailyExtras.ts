"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Quote } from "@/lib/types";

/** Days since the epoch — the same everywhere, so the house shares a quote. */
function dayNumber(d = new Date()): number {
  return Math.floor(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000,
  );
}

/**
 * The quote of the day.
 *
 * This hook used to carry the "looking forward to" notes as well — reading
 * `family_looking_forward`, and upserting one row per member. The panel that
 * showed them was removed from the Today card, so all of that went with it
 * rather than sitting here unread and being maintained by whoever touches this
 * file next.
 *
 * The table and its rows are deliberately left in the database. Nothing reads
 * them, they cost nothing, and restoring the panel later is then a UI change
 * rather than an apology.
 */
export function useDailyExtras(ready = true) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_quotes")
      .select("*")
      .eq("is_active", true)
      .order("created_at");

    if (err) setError(err.message);
    else {
      setQuotes((data ?? []) as Quote[]);
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

  return { quoteOfTheDay, loading, error };
}
