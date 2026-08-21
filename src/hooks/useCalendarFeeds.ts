"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { CalendarFeed } from "@/lib/types";

interface SyncResult {
  feed_id: string;
  count: number;
  error?: string;
}

/**
 * Subscribed iCalendar feeds. The fetching and RRULE expansion happen in the
 * `family-sync-ical` Edge Function — calendar providers don't send CORS
 * headers, so the browser can't read those URLs itself.
 */
export function useCalendarFeeds(ready = true) {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_calendar_feeds")
      .select("*")
      .order("created_at");

    if (err) setError(err.message);
    else {
      setFeeds((data ?? []) as CalendarFeed[]);
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

  const invoke = useCallback(
    async (body: Record<string, unknown>): Promise<SyncResult[]> => {
      setSyncing(true);
      setError(null);

      const { data, error: err } = await getSupabase().functions.invoke("family-sync-ical", {
        body,
      });

      setSyncing(false);
      if (err) {
        setError(err.message);
        return [];
      }
      const results = (data?.results ?? []) as SyncResult[];
      const failed = results.filter((r) => r.error);
      if (failed.length) setError(failed.map((f) => f.error).join("; "));
      await load();
      return results;
    },
    [load],
  );

  const addFeed = useCallback(
    async (memberId: string | null, name: string, url: string) => {
      const { data, error: err } = await getSupabase()
        .from("family_calendar_feeds")
        .insert({ member_id: memberId, name: name.trim(), url: url.trim() })
        .select()
        .single();

      if (err) {
        setError(err.message);
        return false;
      }
      // Pull it in straight away so the calendar is populated immediately.
      const results = await invoke({ feed_id: (data as CalendarFeed).id });
      return results.every((r) => !r.error);
    },
    [invoke],
  );

  const importIcs = useCallback(
    async (memberId: string | null, name: string, ics: string) => {
      const results = await invoke({ member_id: memberId, name, ics });
      return results.every((r) => !r.error);
    },
    [invoke],
  );

  const syncFeed = useCallback((feedId: string) => invoke({ feed_id: feedId }), [invoke]);
  const syncAll = useCallback(() => invoke({ sync_all: true }), [invoke]);

  const removeFeed = useCallback(
    async (feedId: string) => {
      // Entries cascade with the feed, so the calendar cleans itself up.
      const { error: err } = await getSupabase()
        .from("family_calendar_feeds")
        .delete()
        .eq("id", feedId);
      if (err) {
        setError(err.message);
        return;
      }
      setFeeds((prev) => prev.filter((f) => f.id !== feedId));
    },
    [],
  );

  return {
    feeds,
    loading,
    syncing,
    error,
    addFeed,
    importIcs,
    syncFeed,
    syncAll,
    removeFeed,
    reload: load,
  };
}
