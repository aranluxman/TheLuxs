"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { removeMedia, signMediaUrls } from "@/lib/storage";
import { readLastRead, writeLastRead } from "@/lib/chatRead";
import {
  conversationKeyFor,
  type AttachmentKind,
  type ConversationId,
  type Message,
} from "@/lib/types";

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
 * The `where` that narrows a read to one thread.
 *
 * Written as two literal filter calls at each site rather than a shared
 * generic helper: PostgREST's builder type is recursive, and a generic wrapper
 * over it makes the compiler give up with TS2589.
 *
 * The group thread matches on `recipient_id is null`; a DM matches on the
 * generated `conversation_key`, which is one indexed equality for either
 * direction of the conversation.
 */

/**
 * The chat: one group thread plus a one-to-one thread with each other member.
 *
 * Two decisions shape this hook.
 *
 * **Threads are cached per conversation, not refetched on every switch.** A
 * `Record<conversationKey, Message[]>` means bouncing between Everyone and a
 * DM is instant and issues no query, and — more importantly — pagination state
 * survives, so switching away from a thread you had scrolled back into does not
 * throw that history away.
 *
 * **One realtime subscription covers every thread, filtered in the client.**
 * Subscribing per conversation would rebind the socket on every tap and leave a
 * window where messages are missed, and it could not express the group thread
 * anyway (`postgres_changes` filters have no `is null`). Holding every row is
 * also the only reason the unread dots can exist without a second query per
 * conversation. In a five-person house the volume is nothing.
 *
 * Note that filtering here is *not* a privacy boundary. The SELECT policy is
 * `using (true)` because there is no login, so every browser is sent every
 * message and drops the ones it is not part of as a courtesy. See the header of
 * migration 0006 and the README's Security model.
 */
export function useMessages(
  meId: string | null,
  conversation: ConversationId,
  /** Every *other* member's id — the threads that can carry an unread dot. */
  peerIds: string[],
  ready = true,
) {
  /** conversationKey → the loaded page of that thread, oldest first. */
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [hasOlderBy, setHasOlderBy] = useState<Record<string, boolean>>({});
  /** conversationKey → newest `created_at` from somebody else. */
  const [latestAt, setLatestAt] = useState<Record<string, string>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeKey = meId ? conversationKeyFor(meId, conversation) : null;

  // Conversations a load has been started for. A ref because it must not
  // re-trigger the effect that writes to it.
  const started = useRef<Set<string>>(new Set());

  // Mirrors `mediaUrls` for reads inside callbacks. Without it, `signMissing`
  // would have to depend on `mediaUrls`, and every new signature would rebuild
  // the callback and re-run the effects that hold it.
  const signedPaths = useRef<Set<string>>(new Set());

  /*
   * There is deliberately no "clear the cache when the profile switches".
   *
   * A DM's key contains both member ids, so one member's threads can never be
   * read under another's key. The only shared key is the group thread, whose
   * contents are the same for everybody — so keeping it across a switch is a
   * free instant paint rather than a leak. What *is* per-member is `latestAt`
   * ("newest message not from me"), and the bootstrap below recomputes that
   * whenever `meId` changes.
   */

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

  /**
   * Re-signs every attachment on any loaded thread, before the URLs expire.
   *
   * Keyed by storage path rather than by conversation, which is what lets the
   * whole cache survive a switch: a photo signed in the group thread is not
   * re-signed when the same path turns up again.
   */
  const refreshMediaUrls = useCallback(async () => {
    const paths = [...signedPaths.current];
    if (paths.length === 0) return;
    const signed = await signMediaUrls(paths);
    setMediaUrls((prev) => ({ ...prev, ...signed }));
  }, []);

  /** First page of one thread. Takes its key so the callback stays stable. */
  const load = useCallback(
    async (key: string, target: ConversationId, forMe: string) => {
      if (!isSupabaseConfigured) return;
      const base = getSupabase().from("family_messages").select("*");
      const scoped =
        target === null
          ? base.is("recipient_id", null)
          : base.eq("conversation_key", conversationKeyFor(forMe, target));

      const { data, error: err } = await scoped
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (err) {
        setError(err.message);
        // Let it be retried rather than leaving the thread stuck on "Loading…".
        started.current.delete(key);
        return;
      }

      const rows = (data ?? []) as Message[];
      const page = rows.slice(0, PAGE_SIZE).reverse();
      setHasOlderBy((prev) => ({ ...prev, [key]: rows.length > PAGE_SIZE }));
      setThreads((prev) => ({ ...prev, [key]: page }));
      setError(null);
      await signMissing(page);
    },
    [signMissing],
  );

  const loadOlder = useCallback(async () => {
    if (!activeKey || !meId || loadingOlder) return;
    const oldest = threads[activeKey]?.[0];
    if (!oldest) return;
    setLoadingOlder(true);

    const base = getSupabase().from("family_messages").select("*");
    const scoped =
      conversation === null
        ? base.is("recipient_id", null)
        : base.eq("conversation_key", conversationKeyFor(meId, conversation));

    const { data, error: err } = await scoped
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (err) {
      setError(err.message);
      setLoadingOlder(false);
      return;
    }

    const rows = (data ?? []) as Message[];
    const page = rows.slice(0, PAGE_SIZE).reverse();
    setHasOlderBy((prev) => ({ ...prev, [activeKey]: rows.length > PAGE_SIZE }));
    setThreads((prev) => ({ ...prev, [activeKey]: [...page, ...(prev[activeKey] ?? [])] }));
    setLoadingOlder(false);
    await signMissing(page);
  }, [activeKey, meId, conversation, threads, loadingOlder, signMissing]);

  // Fetch a thread the first time it is opened, and never again — switching
  // back to a visited conversation is a cache hit.
  useEffect(() => {
    if (!ready || !activeKey || !meId || started.current.has(activeKey)) return;
    started.current.add(activeKey);
    void load(activeKey, conversation, meId);
  }, [ready, activeKey, meId, conversation, load]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => void refreshMediaUrls(), RESIGN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, refreshMediaUrls]);

  /**
   * The newest thing anyone else has said in each thread, so a conversation can
   * carry a dot before it has ever been opened. One indexed lookup per
   * conversation — at most five in this house — rather than a live query per
   * dot.
   */
  const peerKey = peerIds.join(",");
  useEffect(() => {
    if (!isSupabaseConfigured || !ready || !meId) return;
    let cancelled = false;

    (async () => {
      const targets: ConversationId[] = [null, ...peerIds];
      const found: Record<string, string> = {};

      await Promise.all(
        targets.map(async (target) => {
          const base = getSupabase().from("family_messages").select("created_at");
          const scoped =
            target === null
              ? base.is("recipient_id", null)
              : base.eq("conversation_key", conversationKeyFor(meId, target));

          const { data } = await scoped
            // Your own message never marks a thread unread, and a tombstone is
            // not news.
            .neq("sender_id", meId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1);

          const at = (data as { created_at: string }[] | null)?.[0]?.created_at;
          if (at) found[conversationKeyFor(meId, target)] = at;
        }),
      );

      // Merge by max, and only by max. `found` is the authoritative catch-up
      // for this member, but a message that arrived over the socket while
      // these queries were in flight must not be rolled back — and dropping
      // keys `found` happens to lack would do exactly that.
      //
      // Max alone is also what makes a profile switch correct without a reset:
      // the previous member's mark for the group thread excluded their own
      // messages, so the new member's catch-up can only be newer or equal.
      if (!cancelled) {
        setLatestAt((prev) => {
          const next = { ...prev };
          for (const [key, at] of Object.entries(found)) {
            if ((next[key] ?? "") < at) next[key] = at;
          }
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // peerKey rather than peerIds: the array identity changes on every render
    // of the caller, the membership almost never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, meId, peerKey]);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready || !meId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_messages" },
        (payload) => {
          const row = payload.new as Message;
          if (!row.sender_id) return;
          // Routed on sender_id/recipient_id, deliberately NOT on
          // conversation_key: that column is `generated`, and Postgres before
          // 18 does not emit generated columns to logical replication at all,
          // so it arrives undefined here even though the REST reads have it.
          const key = conversationKeyFor(row.sender_id, row.recipient_id);

          setThreads((prev) => {
            // Only append into a thread that has been loaded. Seeding a
            // half-populated one would break its pagination: `loadOlder` keysets
            // off the oldest row it holds, and that would be the newest message.
            const held = prev[key];
            if (!held) return prev;
            // The sender already inserted it locally; do not double up.
            if (held.some((m) => m.id === row.id)) return prev;
            return { ...prev, [key]: [...held, row] };
          });

          if (row.sender_id !== meId) {
            setLatestAt((prev) =>
              (prev[key] ?? "") >= row.created_at ? prev : { ...prev, [key]: row.created_at },
            );
          }
          // No point spending a signature on a thread nobody has opened.
          if (row.attachment_path && started.current.has(key)) void signMissing([row]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "family_messages" },
        (payload) => {
          // Deletions arrive here, since they are tombstones rather than DELETEs.
          // Applied across every cached thread by id: cheaper than working out
          // which one it is, and immune to any key disagreement.
          const row = payload.new as Message;
          setThreads((prev) => replaceById(prev, row.id, () => row));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_messages" },
        (payload) => {
          const row = payload.old as Message;
          setThreads((prev) => removeById(prev, row.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, meId, signMissing]);

  const sendMessage = useCallback(
    async (
      senderId: string,
      /**
       * Passed in rather than read off the hook's current conversation, and
       * captured by the caller *before* it awaits an upload: otherwise
       * switching threads mid-upload delivers the photo to the wrong person.
       */
      recipientId: ConversationId,
      text: string,
      attachment?: OutgoingAttachment,
    ) => {
      const body = text.trim();
      if (!body && !attachment) return;

      const { data, error: err } = await getSupabase()
        .from("family_messages")
        .insert({
          sender_id: senderId,
          recipient_id: recipientId,
          message_text: body,
          attachment_path: attachment?.path ?? null,
          attachment_kind: attachment?.kind ?? null,
          attachment_name: attachment?.name ?? null,
          attachment_mime: attachment?.mime ?? null,
          attachment_size: attachment?.size ?? null,
          attachment_duration: attachment?.duration ?? null,
          // conversation_key is deliberately absent: it is `generated always`,
          // and naming it in an insert is rejected outright, not ignored.
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
      const key = conversationKeyFor(senderId, recipientId);
      setThreads((prev) => {
        const held = prev[key];
        if (!held) return prev;
        return held.some((m) => m.id === row.id) ? prev : { ...prev, [key]: [...held, row] };
      });
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
   *
   * `recipient_id` is untouched, so the tombstone stays in the thread the
   * message was in — a deleted DM does not surface in the group chat.
   */
  const deleteMessage = useCallback(
    async (messageId: string, byMemberId: string) => {
      const target = findById(threads, messageId);
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

      setThreads((prev) => replaceById(prev, messageId, () => data as Message));
    },
    [threads],
  );

  const messages = useMemo(
    () => (activeKey ? (threads[activeKey] ?? []) : []),
    [threads, activeKey],
  );

  /** conversationKey → somebody has said something you have not seen. */
  const unread = useMemo(() => {
    // Read straight from storage rather than mirroring it into state: the two
    // dependencies below are exactly when a dot can appear or clear, and
    // `markRead` has already written by the time either of them changes.
    const marks = readLastRead(meId);
    const out: Record<string, boolean> = {};
    for (const [key, at] of Object.entries(latestAt)) {
      // The thread on screen is read by definition — you are looking at it.
      // Saying so here rather than racing `markRead` is what stops a dot
      // blinking on the pill you are already reading.
      out[key] = key !== activeKey && at > (marks[key] ?? "");
    }
    return out;
  }, [latestAt, activeKey, meId]);

  /**
   * Marks the open thread read up to its newest message.
   *
   * The mark is that message's `created_at`, never `Date.now()`: these are
   * compared against server timestamps, and a tablet whose clock runs fast
   * would mark threads read before their messages arrived.
   */
  const markRead = useCallback(() => {
    if (!meId || !activeKey) return;
    const held = threads[activeKey];
    const newest = held?.[held.length - 1]?.created_at ?? latestAt[activeKey];
    if (!newest) return;
    // writeLastRead only ever moves a mark forward, so a redundant call is a
    // no-op rather than a rewind.
    writeLastRead(meId, activeKey, newest);
  }, [meId, activeKey, threads, latestAt]);

  // Reading is what clears a dot, so this follows whatever is on screen. It
  // only writes to a ref and to localStorage — no state, so no re-render.
  useEffect(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    markRead();
  }, [markRead]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  return {
    messages,
    mediaUrls,
    /** No page held for the open thread yet — not "no messages in it". */
    loading: Boolean(activeKey) && threads[activeKey!] === undefined,
    loadingOlder,
    hasOlder: Boolean(activeKey && hasOlderBy[activeKey]),
    error,
    unread,
    sendMessage,
    deleteMessage,
    loadOlder,
    refreshMediaUrls,
  };
}

/* ------------------------------------------------- cache-wide row edits ---
 * A message id is unique across every thread, so these do not need to know
 * which conversation a row is in — which is exactly what makes them immune to
 * a routing disagreement.
 */

function findById(threads: Record<string, Message[]>, id: string): Message | null {
  for (const held of Object.values(threads)) {
    const hit = held.find((m) => m.id === id);
    if (hit) return hit;
  }
  return null;
}

function replaceById(
  threads: Record<string, Message[]>,
  id: string,
  next: (current: Message) => Message,
): Record<string, Message[]> {
  let changed = false;
  const out: Record<string, Message[]> = {};
  for (const [key, held] of Object.entries(threads)) {
    if (!held.some((m) => m.id === id)) {
      out[key] = held;
      continue;
    }
    changed = true;
    out[key] = held.map((m) => (m.id === id ? next(m) : m));
  }
  return changed ? out : threads;
}

function removeById(
  threads: Record<string, Message[]>,
  id: string,
): Record<string, Message[]> {
  let changed = false;
  const out: Record<string, Message[]> = {};
  for (const [key, held] of Object.entries(threads)) {
    if (!held.some((m) => m.id === id)) {
      out[key] = held;
      continue;
    }
    changed = true;
    out[key] = held.filter((m) => m.id !== id);
  }
  return changed ? out : threads;
}
