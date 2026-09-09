"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessages, type OutgoingAttachment } from "@/hooks/useMessages";
import { useReactions } from "@/hooks/useReactions";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { formatChatDay, formatTime, parseISO } from "@/lib/dates";
import { tint } from "@/lib/palette";
import { formatBytes, formatDuration, uploadMedia } from "@/lib/storage";
import {
  REACTION_EMOJI,
  conversationKeyFor,
  type AttachmentKind,
  type ConversationId,
  type Message,
  type MemberWithPhoto,
  type ReactionEmoji,
  type ReactionSummary,
} from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, ErrorNote, Modal } from "./ui";

/** Consecutive messages from one person inside this window are stacked. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Rendered {
  message: Message;
  at: Date;
  mine: boolean;
  startsGroup: boolean;
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

function kindFor(file: File): AttachmentKind {
  return file.type.startsWith("image/") ? "image" : "file";
}

/* ------------------------------------------------------------- Attachment */

function AttachmentView({
  message,
  url,
  mine,
}: {
  message: Message;
  url: string | undefined;
  mine: boolean;
}) {
  if (!message.attachment_path || !message.attachment_kind) return null;

  if (!url) {
    return (
      <p className="text-xs opacity-70" role="status">
        Loading attachment…
      </p>
    );
  }

  if (message.attachment_kind === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="-mx-1 -mt-0.5 block overflow-hidden rounded-2xl"
        title={message.attachment_name ?? "Open the full photo"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.attachment_name ?? "Shared photo"}
          className="max-h-80 w-full object-cover transition-transform duration-200 hover:scale-[1.015]"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.attachment_kind === "voice") {
    return (
      <div className="flex items-center gap-2">
        <audio controls preload="none" src={url} className="h-9 max-w-[15rem]" />
        {message.attachment_duration ? (
          <span className="text-[10px] opacity-70">
            {formatDuration(message.attachment_duration)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={message.attachment_name ?? undefined}
      className={`flex items-center gap-2.5 rounded-xl px-1 py-0.5 underline-offset-2 hover:underline ${
        mine ? "text-on-ink" : "text-ink"
      }`}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg"
        style={{ backgroundColor: "rgba(128,128,128,0.16)" }}
        aria-hidden
      >
        📎
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {message.attachment_name ?? "Attachment"}
        </span>
        {message.attachment_size ? (
          <span className="block text-[10px] opacity-70">
            {formatBytes(message.attachment_size)}
          </span>
        ) : null}
      </span>
    </a>
  );
}

/* -------------------------------------------------------------- Reactions */

/**
 * The tallies under a bubble. Each pill shows the emoji, the faces of who left
 * it, and a count once it stops being obvious — tapping toggles your own,
 * which is the same gesture as adding one from the picker.
 */
function ReactionPills({
  summaries,
  onToggle,
  align,
}: {
  summaries: ReactionSummary[];
  onToggle: (emoji: ReactionEmoji) => void;
  align: "start" | "end";
}) {
  const { byId } = useFamily();
  if (summaries.length === 0) return null;

  return (
    <div
      className={`mt-1 flex flex-wrap gap-1 ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      {summaries.map((s) => {
        const people = s.memberIds.map((id) => byId[id]).filter(Boolean);
        const names = people.map((p) => p.name).join(", ");
        return (
          <button
            key={s.emoji}
            onClick={() => onToggle(s.emoji)}
            title={`${names || "Someone"} reacted with ${s.emoji}`}
            aria-pressed={s.mine}
            aria-label={`${s.emoji}, ${s.memberIds.length} ${
              s.memberIds.length === 1 ? "person" : "people"
            }${s.mine ? ", including you" : ""}. Toggle your reaction.`}
            className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-1.5 text-[11px] transition-colors ${
              s.mine
                ? "border-accent bg-accent/12 text-ink font-semibold"
                : "border-line bg-surface text-muted hover:bg-sunk"
            }`}
          >
            <span aria-hidden>{s.emoji}</span>
            {/* Faces beat a bare number in a five-person house — you can see at
                a glance whether the person you care about laughed. */}
            <span className="flex -space-x-1.5" aria-hidden>
              {people.slice(0, 3).map((p) => (
                <span key={p.id} className="ring-surface rounded-full ring-2">
                  <Avatar member={p} size="xs" />
                </span>
              ))}
            </span>
            {people.length > 3 ? (
              <span className="tabular-nums" aria-hidden>
                +{people.length - 3}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The three-emoji picker that opens when a message is tapped. */
function ReactionPicker({
  summaries,
  onPick,
  onDelete,
}: {
  summaries: ReactionSummary[];
  onPick: (emoji: ReactionEmoji) => void;
  onDelete: (() => void) | null;
}) {
  const mineFor = (emoji: ReactionEmoji) => summaries.some((s) => s.emoji === emoji && s.mine);

  return (
    <div className="border-line bg-surface flex items-center gap-0.5 rounded-full border p-1 shadow-lg">
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          aria-pressed={mineFor(emoji)}
          aria-label={`React with ${emoji}`}
          className={`grid h-8 w-8 place-items-center rounded-full text-base transition-transform hover:scale-115 ${
            mineFor(emoji) ? "bg-accent/15" : "hover:bg-sunk"
          }`}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
      {onDelete ? (
        <>
          <span className="bg-line mx-0.5 h-5 w-px" aria-hidden />
          <button
            onClick={onDelete}
            aria-label="Delete this message for everyone"
            className="text-faint hover:bg-danger-soft hover:text-danger grid h-8 w-8 place-items-center rounded-full text-sm"
          >
            <span aria-hidden>🗑</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- Conversations */

/** The "something happened here" mark on a conversation you are not reading. */
function UnreadDot() {
  return (
    <span className="bg-accent absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full">
      <span className="sr-only">Unread messages</span>
    </span>
  );
}

/**
 * Everyone, or one person.
 *
 * Deliberately the same pill strip the Calendar tab uses for whose schedule to
 * show — this is the second place in the app that means "filter to one member",
 * and two different controls for one idea is how an app starts feeling
 * assembled rather than designed.
 *
 * Two differences from that one. You are not in the list: a message to yourself
 * is rejected by a CHECK constraint and means nothing anyway. And the pills set
 * rather than toggle, because Everyone has its own pill to go back to.
 */
function ConversationBar({
  peers,
  meId,
  active,
  unread,
  disabled,
  onPick,
}: {
  peers: MemberWithPhoto[];
  meId: string | null;
  active: ConversationId;
  unread: Record<string, boolean>;
  disabled: boolean;
  onPick: (id: ConversationId) => void;
}) {
  const dotFor = (target: ConversationId) =>
    meId ? unread[conversationKeyFor(meId, target)] : false;

  return (
    <div
      className="scroll-area -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1"
      role="tablist"
      aria-label="Conversation"
    >
      <button
        role="tab"
        aria-selected={active === null}
        disabled={disabled}
        onClick={() => onPick(null)}
        className={`relative inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          active === null
            ? "border-ink bg-ink text-on-ink"
            : "border-line bg-surface text-muted hover:bg-sunk"
        }`}
      >
        <span aria-hidden>👪</span>
        Everyone
        {active !== null && dotFor(null) ? <UnreadDot /> : null}
      </button>

      {peers.map((m) => {
        const isActive = active === m.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            onClick={() => onPick(m.id)}
            className={`relative inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              isActive ? "text-ink" : "border-line bg-surface text-muted hover:bg-sunk"
            }`}
            style={
              isActive
                ? { borderColor: m.color, backgroundColor: tint(m.color, 0.14) }
                : undefined
            }
          >
            <Avatar member={m} size="sm" ring={isActive} />
            {m.name}
            {!isActive && dotFor(m.id) ? <UnreadDot /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- Tab */

export function ChatTab() {
  const { currentMember, byId, members } = useFamily();
  const meId = currentMember?.id ?? null;

  /** `null` is the family thread; a member id is a one-to-one conversation. */
  const [conversation, setConversation] = useState<ConversationId>(null);
  const peers = useMemo(() => members.filter((m) => m.id !== meId), [members, meId]);
  const peerIds = useMemo(() => peers.map((m) => m.id), [peers]);
  const other = conversation ? (byId[conversation] ?? null) : null;

  const {
    messages,
    mediaUrls,
    loading,
    loadingOlder,
    hasOlder,
    error,
    unread,
    sendMessage,
    deleteMessage,
    loadOlder,
  } = useMessages(meId, conversation, peerIds);
  const reactions = useReactions();
  const recorder = useVoiceRecorder();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Message whose reaction picker is open. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Message queued for deletion, held until the prompt is answered. */
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const rows = useMemo(() => render(messages, meId), [messages, meId]);

  // Pull reactions for whatever is on screen, including pages loaded later.
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { ensureFor } = reactions;
  useEffect(() => {
    if (messageIds.length) void ensureFor(messageIds);
  }, [messageIds, ensureFor]);

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

  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // `conversation` is in here so that switching into an already-cached thread
    // still opens at the bottom — that path never flips `loading`.
  }, [loading, conversation]);

  // A reaction picker or a delete prompt is anchored to one message. Carrying
  // either across a switch leaves an overlay pointing at nothing.
  function pickConversation(next: ConversationId) {
    if (next === conversation) return;
    setActiveId(null);
    setPendingDelete(null);
    pinnedToBottom.current = true;
    setConversation(next);
  }

  // Dismiss the picker on Escape, matching the modal's behaviour.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeId]);

  async function submitText(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !currentMember) return;
    setDraft("");
    pinnedToBottom.current = true;
    await sendMessage(currentMember.id, conversation, body);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file || !currentMember) return;

    // Captured before the upload: an await is long enough for someone to tap a
    // different pill, and a photo delivered to the wrong person is not a bug
    // you can take back.
    const target = conversation;

    setUploadError(null);
    setBusy("Uploading…");
    const uploaded = await uploadMedia(file, "chat", "bin");
    if ("error" in uploaded) {
      setUploadError(uploaded.error);
      setBusy(null);
      return;
    }

    const attachment: OutgoingAttachment = {
      path: uploaded.path,
      kind: kindFor(file),
      name: file.name,
      mime: file.type || null,
      size: file.size,
      duration: null,
    };
    pinnedToBottom.current = true;
    await sendMessage(currentMember.id, target, draft.trim(), attachment);
    setDraft("");
    setBusy(null);
  }

  async function finishRecording() {
    if (!currentMember) return;
    const target = conversation; // see onFilePicked
    const clip = await recorder.stop();
    if (!clip) return;

    setUploadError(null);
    setBusy("Sending voice note…");
    const uploaded = await uploadMedia(clip.blob, "chat", "webm");
    if ("error" in uploaded) {
      setUploadError(uploaded.error);
      setBusy(null);
      return;
    }

    pinnedToBottom.current = true;
    await sendMessage(currentMember.id, target, "", {
      path: uploaded.path,
      kind: "voice",
      name: "Voice note",
      mime: clip.mime,
      size: clip.blob.size,
      duration: clip.duration,
    });
    setBusy(null);
  }

  async function confirmDelete() {
    if (!pendingDelete || !currentMember) return;
    setDeleting(true);
    await deleteMessage(pendingDelete.id, currentMember.id);
    setDeleting(false);
    setPendingDelete(null);
    setActiveId(null);
  }

  function toggleReaction(messageId: string, emoji: ReactionEmoji) {
    if (!currentMember) return;
    void reactions.toggle(messageId, currentMember.id, emoji);
    setActiveId(null);
  }

  const canSend = Boolean(currentMember) && !busy;
  const deletingPhoto = pendingDelete?.attachment_kind === "image";

  return (
    // The height is unchanged by the conversation bar on purpose: this is a
    // fixed-height column and the scroll area is the only flex-1 child, so a
    // new sibling shrinks the message list rather than pushing the composer off
    // the bottom. Padding it out for the bar would just leave dead space.
    <div className="flex h-[calc(100dvh-12.5rem)] flex-col sm:h-[calc(100dvh-9.5rem)]">
      <ConversationBar
        peers={peers}
        meId={meId}
        active={conversation}
        unread={unread}
        // Switching mid-upload would strand the "Uploading…" state on a thread
        // that is no longer open.
        disabled={Boolean(busy)}
        onPick={pickConversation}
      />

      {other ? (
        <p className="text-faint mb-2 px-1 text-[11px] leading-snug">
          Just between you and {other.name} — the rest of the family can&rsquo;t see this
          in the app. It isn&rsquo;t private from anyone with the site link, though;
          there&rsquo;s no login yet.
        </p>
      ) : null}

      <ErrorNote message={error ?? uploadError ?? reactions.error ?? recorder.error} />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-area border-line bg-surface flex-1 overflow-y-auto rounded-3xl border px-3 py-4 sm:px-4"
      >
        {loading ? (
          <p className="text-muted py-8 text-center text-sm">Loading messages…</p>
        ) : rows.length === 0 ? (
          <div className="text-muted flex h-full flex-col items-center justify-center gap-2 text-center">
            {other ? (
              <Avatar member={other} size="lg" />
            ) : (
              <span className="text-4xl" aria-hidden>
                💬
              </span>
            )}
            <p className="text-ink text-sm font-medium">
              {other ? `No messages with ${other.name} yet` : "No messages yet"}
            </p>
            <p className="text-xs">
              {other ? `Start a conversation with ${other.name}.` : "Say hello to the family."}
            </p>
          </div>
        ) : (
          <>
            {hasOlder ? (
              <div className="mb-5 text-center">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="border-line text-muted hover:bg-sunk rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            ) : null}

            {rows.map((r) => {
              const sender = r.message.sender_id ? byId[r.message.sender_id] : null;
              const gone = Boolean(r.message.deleted_at);
              const remover = r.message.deleted_by ? byId[r.message.deleted_by] : null;
              const summaries = reactions.summarise(r.message.id, meId);
              const isActive = activeId === r.message.id;
              const color = sender?.color ?? "#78716c";
              // Delete is offered only on your own messages. `deleteMessage`
              // re-checks this against the row itself, so the UI is a
              // convenience rather than the enforcement point.
              const canDelete = !gone && Boolean(currentMember) && r.mine;

              return (
                <div key={r.message.id}>
                  {r.daySeparator ? (
                    <div className="my-5 flex items-center gap-3">
                      <span className="bg-line h-px flex-1" aria-hidden />
                      <span className="text-faint text-[11px] font-semibold tracking-wide">
                        {r.daySeparator}
                      </span>
                      <span className="bg-line h-px flex-1" aria-hidden />
                    </div>
                  ) : null}

                  <div
                    className={`group flex items-end gap-2 ${
                      r.mine ? "justify-end" : "justify-start"
                    } ${r.endsGroup ? "mb-3" : "mb-1"}`}
                  >
                    {!r.mine ? (
                      <span className={r.endsGroup ? "" : "invisible"}>
                        <Avatar member={sender} size="sm" />
                      </span>
                    ) : null}

                    <div
                      className={`flex min-w-0 max-w-[78%] flex-col ${
                        r.mine ? "items-end" : "items-start"
                      }`}
                    >
                      {!r.mine && r.startsGroup ? (
                        <span
                          className="mb-1 ml-1.5 text-[11px] font-semibold tracking-wide"
                          style={{ color }}
                        >
                          {sender?.name ?? "Unknown"}
                        </span>
                      ) : null}

                      {gone ? (
                        <div className="border-line text-faint rounded-2xl border border-dashed px-3.5 py-2 text-xs italic">
                          Message deleted{remover ? ` by ${remover.name}` : ""}
                        </div>
                      ) : (
                        <div className="relative">
                          {/* Tapping the bubble opens the picker, but clicks
                              that land on a link or a player belong to that
                              control — opening a photo must not also react. */}
                          <div
                            role="button"
                            tabIndex={0}
                            aria-haspopup="menu"
                            aria-expanded={isActive}
                            aria-label={`Message from ${
                              r.mine ? "you" : (sender?.name ?? "someone")
                            } at ${formatTime(r.at)}. Activate to react.`}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("a, audio, button")) return;
                              setActiveId(isActive ? null : r.message.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              if ((e.target as HTMLElement).closest("a, audio, button")) return;
                              e.preventDefault();
                              setActiveId(isActive ? null : r.message.id);
                            }}
                            className={`cursor-pointer space-y-1.5 px-3.5 py-2 text-sm break-words whitespace-pre-wrap shadow-sm transition-shadow hover:shadow-md ${
                              r.mine ? "bg-ink text-on-ink" : "text-ink"
                            } ${isActive ? "ring-accent/45 ring-2" : ""}`}
                            style={{
                              backgroundColor: r.mine ? undefined : tint(color, 0.16),
                              borderRadius: 20,
                              borderBottomRightRadius: r.mine && r.endsGroup ? 6 : 20,
                              borderBottomLeftRadius: !r.mine && r.endsGroup ? 6 : 20,
                            }}
                          >
                            <AttachmentView
                              message={r.message}
                              url={
                                r.message.attachment_path
                                  ? mediaUrls[r.message.attachment_path]
                                  : undefined
                              }
                              mine={r.mine}
                            />
                            {r.message.message_text ? <p>{r.message.message_text}</p> : null}
                          </div>

                          {isActive ? (
                            <div
                              className={`absolute -top-11 z-20 ${r.mine ? "right-0" : "left-0"}`}
                            >
                              <ReactionPicker
                                summaries={summaries}
                                onPick={(emoji) => toggleReaction(r.message.id, emoji)}
                                onDelete={
                                  canDelete ? () => setPendingDelete(r.message) : null
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                      )}

                      <ReactionPills
                        summaries={summaries}
                        onToggle={(emoji) => toggleReaction(r.message.id, emoji)}
                        align={r.mine ? "end" : "start"}
                      />

                      {r.endsGroup ? (
                        <span className="text-faint mt-1 px-1 text-[10px] tabular-nums">
                          {formatTime(r.at)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ------------------------------------------------------- composer */}
      {recorder.recording ? (
        <div className="border-line bg-surface mt-3 flex items-center gap-3 rounded-2xl border px-4 py-3">
          <span
            className="bg-danger h-2.5 w-2.5 animate-pulse rounded-full"
            aria-hidden
          />
          <span className="text-sm font-medium tabular-nums">
            {formatDuration(recorder.seconds)}
          </span>
          <span className="text-faint text-xs">Recording…</span>
          <button
            onClick={recorder.cancel}
            className="text-muted hover:text-ink ml-auto text-sm"
          >
            Cancel
          </button>
          <button
            onClick={finishRecording}
            className="bg-ink text-on-ink grid h-10 w-10 place-items-center rounded-full"
            aria-label="Send voice note"
          >
            ↑
          </button>
        </div>
      ) : (
        <form onSubmit={submitText} className="mt-3 flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={onFilePicked}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canSend}
            className="border-line hover:bg-sunk grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg transition-colors disabled:opacity-40"
            aria-label="Attach a file or photo"
            title="Attach a file or photo"
          >
            📎
          </button>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitText();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={
              busy ??
              (!currentMember
                ? "Pick a profile first"
                : other
                  ? `Message ${other.name}…`
                  : `Message as ${currentMember.name}…`)
            }
            disabled={!canSend}
            className="border-line bg-surface text-ink placeholder:text-faint focus:border-ink max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border px-4 py-3 text-sm focus:outline-none disabled:opacity-60"
          />

          {draft.trim() ? (
            <button
              type="submit"
              disabled={!canSend}
              className="bg-ink text-on-ink grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-35"
              aria-label="Send message"
            >
              ↑
            </button>
          ) : (
            <button
              type="button"
              onClick={recorder.start}
              disabled={!canSend || !recorder.supported}
              title={recorder.supported ? "Record a voice note" : "Recording isn't supported here"}
              className="border-line hover:bg-sunk grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg transition-colors disabled:opacity-40"
              aria-label="Record a voice note"
            >
              🎤
            </button>
          )}
        </form>
      )}

      {/* Deletion is for everyone and the file leaves the bucket with it, so
          it gets a real prompt rather than an inline undo affordance. */}
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title={deletingPhoto ? "Delete this photo?" : "Delete this message?"}
      >
        <p className="text-muted text-sm">
          {other
            ? `This removes it for both you and ${other.name}, on every device.`
            : "This removes it for everyone in the family, on every device."}
          {pendingDelete?.attachment_path ? (
            <>
              {" "}
              The {deletingPhoto ? "photo" : "attached file"} is deleted from storage too and
              cannot be recovered.
            </>
          ) : null}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={deleting}
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={deleting} onClick={confirmDelete}>
            {deleting ? "Deleting…" : other ? "Delete for both" : "Delete for everyone"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
