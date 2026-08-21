"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessages, type OutgoingAttachment } from "@/hooks/useMessages";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { formatChatDay, formatTime, parseISO } from "@/lib/dates";
import { tint } from "@/lib/palette";
import { formatBytes, formatDuration, uploadMedia } from "@/lib/storage";
import type { AttachmentKind, Message } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, ErrorNote } from "./ui";

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
    return <p className="text-xs opacity-70">Loading attachment…</p>;
  }

  if (message.attachment_kind === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.attachment_name ?? "Shared photo"}
          className="max-h-72 w-full rounded-xl object-cover"
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
        mine ? "text-white" : "text-ink"
      }`}
    >
      <span className="text-xl" aria-hidden>
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

/* ------------------------------------------------------------------- Tab */

export function ChatTab() {
  const { currentMember, byId } = useFamily();
  const {
    messages,
    mediaUrls,
    loading,
    loadingOlder,
    hasOlder,
    error,
    sendMessage,
    deleteMessage,
    loadOlder,
  } = useMessages();
  const recorder = useVoiceRecorder();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loading]);

  async function submitText(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !currentMember) return;
    setDraft("");
    pinnedToBottom.current = true;
    await sendMessage(currentMember.id, body);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file || !currentMember) return;

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
    await sendMessage(currentMember.id, draft.trim(), attachment);
    setDraft("");
    setBusy(null);
  }

  async function finishRecording() {
    if (!currentMember) return;
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
    await sendMessage(currentMember.id, "", {
      path: uploaded.path,
      kind: "voice",
      name: "Voice note",
      mime: clip.mime,
      size: clip.blob.size,
      duration: clip.duration,
    });
    setBusy(null);
  }

  const canSend = Boolean(currentMember) && !busy;

  return (
    <div className="flex h-[calc(100dvh-12.5rem)] flex-col sm:h-[calc(100dvh-9.5rem)]">
      <ErrorNote message={error ?? uploadError ?? recorder.error} />

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
          <>
            {hasOlder ? (
              <div className="mb-4 text-center">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="border-line text-muted hover:bg-sunk rounded-full border px-3 py-1 text-xs"
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            ) : null}

            {rows.map((r) => {
              const sender = r.message.sender_id ? byId[r.message.sender_id] : null;
              const gone = Boolean(r.message.deleted_at);
              const remover = r.message.deleted_by ? byId[r.message.deleted_by] : null;

              return (
                <div key={r.message.id}>
                  {r.daySeparator ? (
                    <p className="text-faint my-4 text-center text-[11px] font-medium">
                      {r.daySeparator}
                    </p>
                  ) : null}

                  <div
                    className={`group flex items-end gap-2 ${
                      r.mine ? "justify-end" : "justify-start"
                    } ${r.endsGroup ? "mb-2.5" : "mb-0.5"}`}
                  >
                    {!r.mine ? (
                      <span className={r.endsGroup ? "" : "invisible"}>
                        <Avatar member={sender} size="sm" />
                      </span>
                    ) : null}

                    <div
                      className={`flex max-w-[78%] flex-col ${
                        r.mine ? "items-end" : "items-start"
                      }`}
                    >
                      {!r.mine && r.startsGroup ? (
                        <span
                          className="mb-0.5 ml-1 text-[11px] font-semibold"
                          style={{ color: sender?.color ?? "#78716c" }}
                        >
                          {sender?.name ?? "Unknown"}
                        </span>
                      ) : null}

                      {gone ? (
                        <div className="border-line text-faint rounded-2xl border border-dashed px-3.5 py-2 text-xs italic">
                          Message deleted{remover ? ` by ${remover.name}` : ""}
                        </div>
                      ) : (
                        <div
                          className={`space-y-1.5 px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${
                            r.mine ? "bg-ink text-white" : "text-ink"
                          }`}
                          style={{
                            backgroundColor: r.mine
                              ? undefined
                              : tint(sender?.color ?? "#78716c", 0.13),
                            borderRadius: 18,
                            borderBottomRightRadius: r.mine && r.endsGroup ? 5 : 18,
                            borderBottomLeftRadius: !r.mine && r.endsGroup ? 5 : 18,
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
                      )}

                      <span className="text-faint mt-1 flex items-center gap-2 px-1 text-[10px]">
                        {r.endsGroup ? formatTime(r.at) : null}
                        {!gone && currentMember ? (
                          confirmDelete === r.message.id ? (
                            <>
                              <button
                                onClick={async () => {
                                  await deleteMessage(r.message.id, currentMember.id);
                                  setConfirmDelete(null);
                                }}
                                className="font-semibold text-red-700"
                              >
                                Delete
                              </button>
                              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(r.message.id)}
                              className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                              aria-label="Delete this message"
                            >
                              Delete
                            </button>
                          )
                        ) : null}
                      </span>
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
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
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
            className="bg-ink grid h-10 w-10 place-items-center rounded-full text-white"
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
            className="border-line hover:bg-sunk grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg disabled:opacity-40"
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
              busy ?? (currentMember ? `Message as ${currentMember.name}…` : "Pick a profile first")
            }
            disabled={!canSend}
            className="border-line bg-surface text-ink placeholder:text-faint focus:border-ink max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border px-4 py-3 text-sm focus:outline-none disabled:opacity-60"
          />

          {draft.trim() ? (
            <button
              type="submit"
              disabled={!canSend}
              className="bg-ink grid h-11 w-11 shrink-0 place-items-center rounded-full text-white disabled:opacity-35"
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
              className="border-line hover:bg-sunk grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg disabled:opacity-40"
              aria-label="Record a voice note"
            >
              🎤
            </button>
          )}
        </form>
      )}
    </div>
  );
}
