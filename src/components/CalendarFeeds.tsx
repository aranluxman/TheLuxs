"use client";

import { useState } from "react";
import { useCalendarFeeds } from "@/hooks/useCalendarFeeds";
import { format, parseISO } from "@/lib/dates";
import { useFamily } from "./FamilyProvider";
import { Avatar, Button, ErrorNote, Field, Modal, inputClass } from "./ui";

/**
 * Subscribe each person's calendar so they all overlay on the family view.
 * Two ways in: a live URL that re-syncs, or a one-off paste of an .ics export.
 */
export function CalendarFeeds({
  open,
  onClose,
  onSynced,
}: {
  open: boolean;
  onClose: () => void;
  onSynced: () => void;
}) {
  const { members, currentMember } = useFamily();
  const { feeds, syncing, error, addFeed, importIcs, syncFeed, syncAll, removeFeed } =
    useCalendarFeeds(open);

  const [mode, setMode] = useState<"url" | "paste">("url");
  const [memberId, setMemberId] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ics, setIcs] = useState("");

  const owner = memberId || currentMember?.id || members[0]?.id || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const label = name.trim() || members.find((m) => m.id === owner)?.name || "Calendar";
    const ok =
      mode === "url"
        ? url.trim() && (await addFeed(owner, label, url))
        : ics.trim() && (await importIcs(owner, label, ics));

    if (ok) {
      setUrl("");
      setIcs("");
      setName("");
      onSynced();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Calendar feeds">
      <ErrorNote message={error} />

      {feeds.length > 0 ? (
        <ul className="mb-5 space-y-2">
          {feeds.map((f) => {
            const member = f.member_id ? members.find((m) => m.id === f.member_id) : null;
            return (
              <li key={f.id} className="border-line bg-surface-raised flex items-center gap-3 rounded-2xl border p-3 shadow-sm">
                <Avatar member={member ?? null} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-faint truncate text-[11px] leading-relaxed">
                    {f.last_error
                      ? `Failed: ${f.last_error}`
                      : f.last_synced_at
                        ? `${f.last_event_count ?? 0} events · synced ${format(
                            parseISO(f.last_synced_at),
                            "MMM d, h:mm a",
                          )}`
                        : "Not synced yet"}
                    {f.has_url ? "" : " · one-off import"}
                  </p>
                </div>
                {f.has_url ? (
                  <button
                    onClick={async () => {
                      await syncFeed(f.id);
                      onSynced();
                    }}
                    disabled={syncing}
                    className="text-muted hover:text-ink text-xs disabled:opacity-50"
                  >
                    Sync
                  </button>
                ) : null}
                <button
                  onClick={async () => {
                    await removeFeed(f.id);
                    onSynced();
                  }}
                  className="text-faint hover:bg-danger-soft hover:text-danger h-7 w-7 shrink-0 rounded-full text-lg"
                  aria-label={`Remove ${f.name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted mb-5 text-xs">
          Nothing subscribed yet. Add each person&rsquo;s calendar and they&rsquo;ll all
          overlay on the family view, colour-coded by whose it is.
        </p>
      )}

      <div className="bg-sunk mb-4 flex w-full rounded-xl p-1 sm:inline-flex sm:w-auto">
        {(["url", "paste"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:flex-none ${
              mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"
            }`}
          >
            {m === "url" ? "Subscribe to a link" : "Paste an .ics file"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Whose calendar is it?">
          <select
            value={owner}
            onChange={(e) => setMemberId(e.target.value)}
            className={inputClass}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Label" hint="Optional. Defaults to the person's name.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="School timetable"
            className={inputClass}
          />
        </Field>

        {mode === "url" ? (
          <Field
            label="Secret iCal address"
            hint="Google Calendar → Settings → Integrate calendar → Secret address in iCal format. Apple and Outlook both publish a similar link. webcal:// works too."
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              className={inputClass}
            />
          </Field>
        ) : (
          <Field
            label="Paste the file contents"
            hint="Open the .ics file in a text editor and paste everything. This is a one-off import and will not refresh by itself."
          >
            <textarea
              value={ics}
              onChange={(e) => setIcs(e.target.value)}
              rows={6}
              placeholder="BEGIN:VCALENDAR…"
              className={`${inputClass} font-mono text-[11px]`}
            />
          </Field>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={async () => {
              await syncAll();
              onSynced();
            }}
            disabled={syncing || feeds.every((f) => !f.has_url)}
            className="text-muted hover:text-ink text-xs disabled:opacity-40"
          >
            Sync everything now
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={syncing}>
              {syncing ? "Importing…" : "Add calendar"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
