"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Message } from "@/lib/types";

const PAGE_SIZE = 200;

/** The group chat, oldest-first, streaming new arrivals over Realtime. */
export function useMessages(ready = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    // Newest N, then flipped — so a long history does not have to load at once.
    const { data, error: err } = await getSupabase()
      .from("family_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (err) setError(err.message);
    else {
      setMessages(((data ?? []) as Message[]).slice().reverse());
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

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_messages" },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) =>
            // The sender already inserted it locally; do not double up.
            prev.some((m) => m.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_messages" },
        (payload) => {
          const row = payload.old as Message;
          setMessages((prev) => prev.filter((m) => m.id !== row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready]);

  const sendMessage = useCallback(async (senderId: string, text: string) => {
    const body = text.trim();
    if (!body) return;

    const { data, error: err } = await getSupabase()
      .from("family_messages")
      .insert({ sender_id: senderId, message_text: body })
      .select()
      .single();

    if (err) {
      setError(err.message);
      return;
    }
    const row = data as Message;
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
  }, []);

  return { messages, loading, error, sendMessage };
}
