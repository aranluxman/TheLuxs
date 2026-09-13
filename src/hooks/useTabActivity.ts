"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/** Tabs that can carry a "something happened here" dot. */
export type ActivityTab = "calendar" | "todos" | "chores" | "shopping";

const STORAGE_KEY = "family-dashboard:tab-seen";

/**
 * What counts as activity on each tab, and where its timestamp lives.
 *
 * Each is one indexed `order by … desc limit 1` — four small reads on mount,
 * not a count or a scan. Realtime then pushes the value forward, so the dots
 * appear without anyone reloading.
 */
const SOURCES: Record<ActivityTab, { table: string; column: string }> = {
  calendar: { table: "family_calendar_entries", column: "created_at" },
  todos: { table: "family_todos", column: "created_at" },
  chores: { table: "family_chore_ticks", column: "done_at" },
  shopping: { table: "family_shopping_items", column: "created_at" },
};

const TABS = Object.keys(SOURCES) as ActivityTab[];

type Marks = Partial<Record<ActivityTab, string>>;

function readSeen(): Marks {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Marks) : {};
  } catch {
    return {};
  }
}

/**
 * A dot on a tab when something has happened there since this device last
 * looked at it.
 *
 * Per device, in `localStorage`, for the same reason the chat's read marks are:
 * there is no login, so a "last seen" column would be a row anyone holding the
 * publishable key could rewrite, and it could not be attributed to a person
 * anyway. The visible consequence is that clearing a dot on the tablet leaves
 * it lit on your phone.
 *
 * The mark stored is the newest row's own timestamp, never `Date.now()`. These
 * are compared against server timestamps, and a device whose clock runs a
 * minute fast would otherwise mark a tab seen before its rows arrived and never
 * show a dot again.
 */
export function useTabActivity(ready = true) {
  const [latest, setLatest] = useState<Marks>({});
  const [seenVersion, setSeenVersion] = useState(0);

  const bump = useCallback((tab: ActivityTab, at: string | null | undefined) => {
    if (!at) return;
    setLatest((prev) => ((prev[tab] ?? "") >= at ? prev : { ...prev, [tab]: at }));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    let cancelled = false;

    (async () => {
      const supabase = getSupabase();
      await Promise.all(
        TABS.map(async (tab) => {
          const { table, column } = SOURCES[tab];
          const { data } = await supabase
            .from(table)
            .select(column)
            .not(column, "is", null)
            .order(column, { ascending: false })
            .limit(1);
          if (cancelled) return;
          const row = (data as Record<string, string>[] | null)?.[0];
          bump(tab, row?.[column]);
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, bump]);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase.channel("family-tab-activity");

    for (const tab of TABS) {
      const { table, column } = SOURCES[tab];
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        (payload) => bump(tab, (payload.new as Record<string, string>)[column]),
      );
      // A chore tick is an upsert: re-ticking an existing row for a new person
      // arrives as an UPDATE, and that is still activity.
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table },
        (payload) => bump(tab, (payload.new as Record<string, string>)[column]),
      );
    }

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, bump]);

  /** Called when a tab is opened — everything on it has now been seen. */
  const markSeen = useCallback(
    (tab: ActivityTab) => {
      const at = latest[tab];
      if (!at) return;
      try {
        const all = readSeen();
        if ((all[tab] ?? "") >= at) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [tab]: at }));
        setSeenVersion((v) => v + 1);
      } catch {
        // Private mode: the dot simply comes back.
      }
    },
    [latest],
  );

  const unseen = useMemo(() => {
    const seen = readSeen();
    const out = {} as Record<ActivityTab, boolean>;
    for (const tab of TABS) out[tab] = Boolean(latest[tab] && latest[tab]! > (seen[tab] ?? ""));
    return out;
    // seenVersion is the signal that localStorage moved; it has no value of its
    // own, and without it a mark written by markSeen would not clear the dot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, seenVersion]);

  return { unseen, markSeen };
}
