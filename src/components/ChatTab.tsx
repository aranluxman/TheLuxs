"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/hooks/useMessages";
import { formatChatDay, formatTime, parseISO } from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { Message } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, ErrorNote } from "./ui";

/** Consecutive messages from one person inside this window are stacked. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Rendered {
  message: Message;
  at: Date;
  mine: boolean;
  /** First of a run — show the avatar and name. */
  startsGroup: boolean;
  /** Last of a run — show the timestamp and the bubble tail. */
  endsGroup: boolean;
  daySeparator: string | null;
}

function render(messages: Message[], meId: string | null): Rendered[] {
  return messages.map((m, i) => {
    const at = parseISO(m.created_at);
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const prevAt = prev ? parseISO(prev.created_at) : null;
    const nextAt = next ? parseISO(next.created_at) : null;

    const newDay = !prevAt || prevAt.toDateString() !== at.toDateString();
    const startsGroup =
      newDay ||
      prev?.sender_id !== m.sender_id ||
      (prevAt ? at.getTime() - prevAt.getTime() > GROUP_WINDOW_MS : true);
    const endsGroup =
      !next ||
      next.sender_id !== m.sender_id ||
      (nextAt ? nextAt.getTime() - at.getTime() > GROUP_WINDOW_MS : true) ||
      (nextAt ? nextAt.toDateString() !== at.toDateString() : true);

    return {
      message: m,
      at,
      mine: m.sender_id === meId,
      startsGroup,
      endsGroup,
      daySeparator: newDay ? formatChatDay(at) : null,
    };
  });
}

export function ChatTab() {
  const { currentMember, byId } = useFamily();
  const { messages, loading, error, sendMessage } = useMessages();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const rows = useMemo(
    () => render(messages, currentMember?.id ?? null),
    [messages, currentMember],
  );

  // Only auto-scroll when the reader was already at the bottom — otherwise a
  // new message would yank them out of the history they are scrolled back into.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  // Jump to the bottom once the history first lands.
  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loading]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !currentMember) return;
    setDraft("");
    setSending(true);
    pinnedToBottom.current = true;
    await sendMessage(currentMember.id, body);
    setSending(false);
  }

  return (
    <div className="flex h-[calc(100dvh-12.5rem)] flex-col sm:h-[calc(100dvh-9.5rem)]">
      <ErrorNote message={error} />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-area border-line bg-surface flex-1 overflow-y-auto rounded-2xl border px-3 py-4"
      >
        {loading ? (
          <p className="text-muted py-8 text-center text-sm">Loading messages…</p>
        ) : rows.length === 0 ? (
          <div className="text-muted flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl" aria-hidden>
              💬
            </span>
            <p className="text-ink text-sm font-medium">No messages yet</p>
            <p className="text-xs">Say hello to the family.</p>
          </div>
        ) : (
          rows.map((r) => {
            const sender = r.message.sender_id ? byId[r.message.sender_id] : null;
            return (
              <div key={r.message.id}>
                {r.daySeparator ? (
                  <p className="text-faint my-4 text-center text-[11px] font-medium">
                    {r.daySeparator}
                  </p>
                ) : null}

                <div
                  className={`flex items-end gap-2 ${r.mine ? "justify-end" : "justify-start"} ${
                    r.endsGroup ? "mb-2.5" : "mb-0.5"
                  }`}
                >
                  {!r.mine ? (
                    <span className={r.endsGroup ? "" : "invisible"}>
                      <Avatar member={sender} size="sm" />
                    </span>
                  ) : null}

                  <div className={`max-w-[78%] ${r.mine ? "items-end" : "items-start"} flex flex-col`}>
                    {!r.mine && r.startsGroup ? (
                      <span
                        className="mb-0.5 ml-1 text-[11px] font-semibold"
                        style={{ color: sender?.color ?? "#78716c" }}
                      >
                        {sender?.name ?? "Unknown"}
                      </span>
                    ) : null}

                    <div
                      className={`px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${
                        r.mine ? "bg-ink text-white" : "text-ink"
                      }`}
                      style={{
                        backgroundColor: r.mine ? undefined : tint(sender?.color ?? "#78716c", 0.13),
                        borderRadius: 18,
                        borderBottomRightRadius: r.mine && r.endsGroup ? 5 : 18,
                        borderBottomLeftRadius: !r.mine && r.endsGroup ? 5 : 18,
                      }}
                    >
                      {r.message.message_text}
                    </div>

                    {r.endsGroup ? (
                      <span className="text-faint mt-1 px-1 text-[10px]">
                        {formatTime(r.at)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={currentMember ? `Message as ${currentMember.name}…` : "Pick a profile first"}
          disabled={!currentMember}
          className="border-line bg-surface text-ink placeholder:text-faint focus:border-ink max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border px-4 py-3 text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || !currentMember}
          className="bg-ink grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-35"
          aria-label="Send message"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
