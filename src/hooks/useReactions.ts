"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  REACTION_EMOJI,
  type MessageReaction,
  type ReactionEmoji,
  type ReactionSummary,
} from "@/lib/types";

/** Stable identity for one (message, member, emoji) triple — the table's PK. */
function keyOf(r: Pick<MessageReaction, "message_id" | "member_id" | "emoji">): string {
  return `${r.message_id}|${r.member_id}|${r.emoji}`;
}

/**
 * Reactions on the group chat.
 *
 * Rows are held in a flat map keyed by the primary key rather than nested per
 * message, because that is what makes the realtime handlers O(1) and makes an
 * optimistic toggle trivially reversible: the same key is written, then either
 * confirmed or deleted.
 *
 * Fetching is driven by whichever messages are on screen. `useMessages` pages
 * older history in, so `ensureFor` is called with a growing id list and only
 * queries the ids it has not already covered.
 */
export function useReactions(ready = true) {
  const [rows, setRows] = useState<Record<string, MessageReaction>>({});
  const [error, setError] = useState<string | null>(null);

  // Message ids already fetched. A ref, not state: it must not re-trigger the
  // effect that writes to it, and nothing renders from it.
  const covered = useRef<Set<string>>(new Set());

  const ensureFor = useCallback(async (messageIds: string[]) => {
    if (!isSupabaseConfigured) return;
    const missing = messageIds.filter((id) => !covered.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) covered.current.add(id);

    const { data, error: err } = await getSupabase()
      .from("family_message_reactions")
      .select("*")
      .in("message_id", missing);

    if (err) {
      // Let the ids be retried on the next page rather than silently blanking.
      for (const id of missing) covered.current.delete(id);
      setError(err.message);
      return;
    }

    setRows((prev) => {
      const next = { ...prev };
      for (const r of (data ?? []) as MessageReaction[]) next[keyOf(r)] = r;
      return next;
    });
    setError(null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !ready) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel("family-message-reactions")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "family_message_reactions" },
        (payload) => {
          const row = payload.new as MessageReaction;
          setRows((prev) => ({ ...prev, [keyOf(row)]: row }));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "family_message_reactions" },
        (payload) => {
          // Needs FULL replica identity on the table, which migration 0003
          // sets — otherwise `payload.old` arrives without the emoji.
          const row = payload.old as Partial<MessageReaction>;
          if (!row.message_id || !row.member_id || !row.emoji) return;
          setRows((prev) => {
            const next = { ...prev };
            delete next[keyOf(row as MessageReaction)];
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready]);

  /**
   * Adds the reaction, or removes it if this member already left it. The
   * local write happens first so the tap feels instant; a failure rolls it
   * back and surfaces the error.
   */
  const toggle = useCallback(
    async (messageId: string, memberId: string, emoji: ReactionEmoji) => {
      const key = keyOf({ message_id: messageId, member_id: memberId, emoji });
      const existing = rows[key];

      if (existing) {
        setRows((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        const { error: err } = await getSupabase()
          .from("family_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("member_id", memberId)
          .eq("emoji", emoji);
        if (err) {
          setRows((prev) => ({ ...prev, [key]: existing }));
          setError(err.message);
        }
        return;
      }

      const optimistic: MessageReaction = {
        message_id: messageId,
        member_id: memberId,
        emoji,
        created_at: new Date().toISOString(),
      };
      setRows((prev) => ({ ...prev, [key]: optimistic }));

      const { error: err } = await getSupabase()
        .from("family_message_reactions")
        .upsert(
          { message_id: messageId, member_id: memberId, emoji },
          // Two devices tapping the same emoji must not 409 against the PK.
          { onConflict: "message_id,member_id,emoji", ignoreDuplicates: true },
        );

      if (err) {
        setRows((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setError(err.message);
      }
    },
    [rows],
  );

  /**
   * Grouped for rendering: message id → one entry per emoji that has at least
   * one reactor, in the palette's fixed order so the row never reshuffles as
   * counts change.
   */
  const byMessage = useMemo(() => {
    const grouped: Record<string, Record<string, string[]>> = {};
    for (const r of Object.values(rows)) {
      ((grouped[r.message_id] ??= {})[r.emoji] ??= []).push(r.member_id);
    }
    return grouped;
  }, [rows]);

  const summarise = useCallback(
    (messageId: string, meId: string | null): ReactionSummary[] => {
      const forMessage = byMessage[messageId];
      if (!forMessage) return [];
      return REACTION_EMOJI.flatMap((emoji) => {
        const memberIds = forMessage[emoji];
        if (!memberIds?.length) return [];
        return [{ emoji, memberIds, mine: Boolean(meId && memberIds.includes(meId)) }];
      });
    },
    [byMessage],
  );

  return {
    ensureFor,
    toggle,
    summarise,
    error,
    /**
     * Number of reaction rows held. Reactions arrive on their own fetch, after
     * the messages have already painted and the thread has already scrolled to
     * the bottom — every pill that lands afterwards grows the content and
     * leaves the newest message clipped under the composer. The chat watches
     * this to re-pin. It changes on exactly the events that change height
     * (an insert or a delete), so it is not a busy signal.
     */
    count: Object.keys(rows).length,
  };
}
