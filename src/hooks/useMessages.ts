"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { signMediaUrls } from "@/lib/storage";
import type { AttachmentKind, Message } from "@/lib/types";

/** Kept modest so the thread paints fast; older pages load on demand. */
const PAGE_SIZE = 60;

export interface OutgoingAttachment {
  path: string;
  kind: AttachmentKind;
  name: string | null;
  mime: string | null;
  size: number | null;
  duration: number | null;
}

/**
 * The group chat. Nothing is ever purged — deletes leave a tombstone — so the
 * full history stays available; it is just paged in a screen at a time.
 */
export function useMessages(ready = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Signs any attachment we do not already hold a URL for. */
  const signMissing = useCallback(async (rows: Message[]) => {
    const paths = rows
      .map((m) => m.attachment_path)
      .filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    const signed = await signMediaUrls(paths);
    setMediaUrls((prev) => ({ ...signed, ...prev }));
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: err } = await getSupabase()
      .from("family_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Message[];
    setHasOlder(rows.length > PAGE_SIZE);
    const page = rows.slice(0, PAGE_SIZE).reverse();
    setMessages(page);
    setError(null);
    setLoading(false);
    await signMissing(page);
  }, [signMissing]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);

    const { data, error: err } = await getSupabase()
      .from("family_messages")
      .select("*")
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (err) {
      setError(err.message);
      setLoadingOlder(false);
      return;
    }

    const rows = (data ?? []) as Message[];
    setHasOlder(rows.length > PAGE_SIZE);
    const page = rows.slice(0, PAGE_SIZE).reverse();
    setMessages((prev) => [...page, ...prev]);
    setLoadingOlder(false);
    await signMissing(page);
  }, [messages, loadingOlder, signMissing]);

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
          if (row.attachment_path) void signMissing([row]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_messages" },
        (payload) => {
          // Deletions arrive here, since they are tombstones rather than DELETEs.
          const row = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
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
  }, [ready, signMissing]);

  const sendMessage = useCallback(
    async (senderId: string, text: string, attachment?: OutgoingAttachment) => {
      const body = text.trim();
      if (!body && !attachment) return;

      const { data, error: err } = await getSupabase()
        .from("family_messages")
        .insert({
          sender_id: senderId,
          message_text: body,
          attachment_path: attachment?.path ?? null,
          attachment_kind: attachment?.kind ?? null,
          attachment_name: attachment?.name ?? null,
          attachment_mime: attachment?.mime ?? null,
          attachment_size: attachment?.size ?? null,
          attachment_duration: attachment?.duration ?? null,
        })
        .select()
        .single();

      if (err) {
        setError(err.message);
        return;
      }
      const row = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      if (row.attachment_path) await signMissing([row]);
    },
    [signMissing],
  );

  /**
   * Soft delete. The row stays so the thread keeps its shape and the history
   * stays complete; the text and any attachment reference are cleared.
   */
  const deleteMessage = useCallback(
    async (messageId: string, byMemberId: string | null) => {
      const { data, error: err } = await getSupabase()
        .from("family_messages")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: byMemberId,
          message_text: "",
          attachment_path: null,
        })
        .eq("id", messageId)
        .select()
        .single();

      if (err) {
        setError(err.message);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === messageId ? (data as Message) : m)));
    },
    [],
  );

  return {
    messages,
    mediaUrls,
    loading,
    loadingOlder,
    hasOlder,
    error,
    sendMessage,
    deleteMessage,
    loadOlder,
  };
}
