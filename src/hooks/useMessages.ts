"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { removeMedia, signMediaUrls } from "@/lib/storage";
import type { AttachmentKind, Message } from "@/lib/types";

/** Kept modest so the thread paints fast; older pages load on demand. */
const PAGE_SIZE = 60;

/**
 * Signed URLs last 8 hours (see `SIGNED_URL_TTL`). This dashboard lives on a
 * kitchen tablet that is never reloaded, so without a refresh every image in
 * the thread would 403 partway through the day. Re-signing on a 7-hour cycle
 * keeps every URL comfortably inside its window.
 */
const RESIGN_INTERVAL_MS = 7 * 60 * 60 * 1000;

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

  // Mirrors `mediaUrls` for reads inside callbacks. Without it, `signMissing`
  // would have to depend on `mediaUrls`, and every new signature would rebuild
  // the callback and re-run the effects that hold it.
  const signedPaths = useRef<Set<string>>(new Set());

  /** Signs any attachment we do not already hold a URL for. */
  const signMissing = useCallback(async (rows: Message[]) => {
    const paths = rows
      .map((m) => m.attachment_path)
      .filter((p): p is string => Boolean(p) && !signedPaths.current.has(p!));
    if (paths.length === 0) return;
    for (const p of paths) signedPaths.current.add(p);

    const signed = await signMediaUrls(paths);
    // Fresh signatures win. The previous version merged the other way round,
    // which meant a re-sign could never actually replace an expiring URL.
    setMediaUrls((prev) => ({ ...prev, ...signed }));
  }, []);

  /** Re-signs every attachment currently on screen, before the URLs expire. */
  const refreshMediaUrls = useCallback(async () => {
    const paths = [...signedPaths.current];
    if (paths.length === 0) return;
    const signed = await signMediaUrls(paths);
    setMediaUrls((prev) => ({ ...prev, ...signed }));
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
    if (!ready) return;
    const id = setInterval(() => void refreshMediaUrls(), RESIGN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, refreshMediaUrls]);

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
        // The upload already succeeded, so a failed insert would strand the
        // object in the bucket with nothing pointing at it.
        if (attachment) await removeMedia([attachment.path]);
        return;
      }
      const row = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      if (row.attachment_path) await signMissing([row]);
    },
    [signMissing],
  );

  /**
   * Delete for everyone. The row survives as a tombstone so the thread keeps
   * its shape, but the text goes, the attachment reference goes, and — unlike
   * before — the storage object itself is removed. A soft delete that left the
   * file in the bucket was not really a delete: anyone holding a signed URL
   * kept working access to the photo.
   *
   * Only the sender may delete. This is enforced in the query rather than in
   * the caller, so a stale UI cannot delete someone else's message: the
   * `eq("sender_id", …)` matches no row and the update is a no-op.
   */
  const deleteMessage = useCallback(
    async (messageId: string, byMemberId: string) => {
      const target = messages.find((m) => m.id === messageId);
      const attachmentPath = target?.attachment_path ?? null;

      const { data, error: err } = await getSupabase()
        .from("family_messages")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: byMemberId,
          message_text: "",
          attachment_path: null,
          attachment_kind: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
          attachment_duration: null,
        })
        .eq("id", messageId)
        .eq("sender_id", byMemberId)
        .select()
        .maybeSingle();

      if (err) {
        setError(err.message);
        return;
      }
      if (!data) {
        setError("You can only delete your own messages.");
        return;
      }

      // Only once the row no longer references it — an orphaned row pointing
      // at a missing object would render a permanently broken attachment.
      if (attachmentPath) {
        signedPaths.current.delete(attachmentPath);
        setMediaUrls((prev) => {
          const next = { ...prev };
          delete next[attachmentPath];
          return next;
        });
        await removeMedia([attachmentPath]);
      }

      setMessages((prev) => prev.map((m) => (m.id === messageId ? (data as Message) : m)));
    },
    [messages],
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
    refreshMediaUrls,
  };
}
