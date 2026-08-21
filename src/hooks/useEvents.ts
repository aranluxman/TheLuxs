"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EventRsvp, FamilyEvent, RsvpStatus } from "@/lib/types";

export interface NewEventInput {
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  created_by: string | null;
}

/** The activity board, plus the per-member RSVP checklist for each event. */
export function useEvents(ready = true) {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    const [ev, rs] = await Promise.all([
      supabase.from("family_events").select("*").order("event_date"),
      supabase.from("family_event_rsvps").select("*"),
    ]);

    if (ev.error || rs.error) {
      setError((ev.error ?? rs.error)!.message);
    } else {
      setEvents((ev.data ?? []) as FamilyEvent[]);
      setRsvps((rs.data ?? []) as EventRsvp[]);
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

  const createEvent = useCallback(
    async (input: NewEventInput) => {
      const { error: err } = await getSupabase().from("family_events").insert(input);
      if (err) {
        setError(err.message);
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const deleteEvent = useCallback(async (id: string) => {
    const { error: err } = await getSupabase().from("family_events").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setRsvps((prev) => prev.filter((r) => r.event_id !== id));
  }, []);

  /**
   * Set (or clear) one member's RSVP. Clearing means "no answer yet", which is
   * distinct from "not going", so it deletes the row rather than storing a state.
   */
  const setRsvp = useCallback(
    async (eventId: string, memberId: string, status: RsvpStatus | null) => {
      const supabase = getSupabase();

      if (status === null) {
        setRsvps((prev) =>
          prev.filter((r) => !(r.event_id === eventId && r.member_id === memberId)),
        );
        const { error: err } = await supabase
          .from("family_event_rsvps")
          .delete()
          .eq("event_id", eventId)
          .eq("member_id", memberId);
        if (err) setError(err.message);
        return;
      }

      const row: EventRsvp = {
        event_id: eventId,
        member_id: memberId,
        status,
        updated_at: new Date().toISOString(),
      };
      setRsvps((prev) => [
        ...prev.filter((r) => !(r.event_id === eventId && r.member_id === memberId)),
        row,
      ]);

      const { error: err } = await supabase
        .from("family_event_rsvps")
        .upsert(
          { event_id: eventId, member_id: memberId, status, updated_at: row.updated_at },
          { onConflict: "event_id,member_id" },
        );
      if (err) {
        setError(err.message);
        await load();
      }
    },
    [load],
  );

  return { events, rsvps, loading, error, createEvent, deleteEvent, setRsvp, reload: load };
}
