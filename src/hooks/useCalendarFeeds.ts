"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** How often a left-open dashboard re-pulls every subscribed feed. */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * A tab that has been in the background all morning should not show a stale
 * calendar the moment it is looked at again, but it also should not re-fetch
 * every feed on every glance.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Keeps subscribed iCal feeds fresh without anyone pressing Sync.
 *
 * Three triggers: once on mount, on a long interval, and when the tab is
 * brought back to the foreground after going stale. The Edge Function replaces
 * each feed's slice of the window wholesale, so a redundant run is harmless —
 * which is what makes it safe for several devices in the house to do this
 * independently.
 *
 * `onSynced` is called only when a run actually happened, so the caller can
 * reload entries without a render loop.
 */
export function useCalendarAutoSync(onSynced: () => void, enabled = true) {
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Held in refs so the effect below can depend on neither, and therefore
  // never tears down and re-arms its timer mid-session.
  const onSyncedRef = useRef(onSynced);
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  // Written in an effect rather than during render: a ref mutated mid-render
  // is not safe under a concurrent render that React later discards.
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  const run = useCallback(async () => {
    if (!isSupabaseConfigured || runningRef.current) return;

    // Only worth invoking the function if something is actually subscribed.
    const { data, error: err } = await getSupabase()
      .from("family_calendar_feeds")
      .select("id")
      .eq("is_active", true)
      .neq("url", "")
      .limit(1);
    if (err || !data?.length) return;

    runningRef.current = true;
    try {
      const { error: invokeError } = await getSupabase().functions.invoke(
        "family-sync-ical",
        { body: { sync_all: true } },
      );
      lastRunRef.current = Date.now();
      setLastSyncedAt(lastRunRef.current);
      // A failed sync still leaves the previously imported entries in place,
      // so the calendar degrades to "slightly stale" rather than to empty.
      if (!invokeError) onSyncedRef.current();
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void run();
    const id = setInterval(() => void run(), AUTO_SYNC_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunRef.current < STALE_AFTER_MS) return;
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, run]);

  return { lastSyncedAt, syncNow: run };
}
