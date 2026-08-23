"use client";

import { useMemo, useState } from "react";
import { useDailyExtras } from "@/hooks/useDailyExtras";
import { useEvents } from "@/hooks/useEvents";
import { formatDayLabel, formatTime, parseISO } from "@/lib/dates";
import { tint } from "@/lib/palette";
import { useFamily } from "./FamilyProvider";
import { Avatar, Card, inputClass } from "./ui";

function daysUntil(date: Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function countdownLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 14) return "next week";
  return `in ${Math.round(days / 7)} weeks`;
}

/**
 * The strip at the top of the Calendar tab: a shared quote for the day, the
 * next thing on the family's calendar, and what each person is looking
 * forward to.
 */
export function TodayCard() {
  const { members, currentMember } = useFamily();
  const { quoteOfTheDay, noteFor, setLookingForward } = useDailyExtras();
  const { events } = useEvents();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Pinned once per mount: reading the clock during render is impure, and the
  // "next" event should not flip mid-session.
  const [now] = useState(() => Date.now());

  const nextEvent = useMemo(() => {
    return (
      events
        .map((e) => ({ event: e, at: parseISO(e.event_date) }))
        .filter((x) => x.at.getTime() >= now)
        .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
    );
  }, [events, now]);

  const mine = currentMember ? noteFor(currentMember.id) : null;
  const others = members.filter((m) => m.id !== currentMember?.id && noteFor(m.id));

  async function save() {
    if (!currentMember) return;
    await setLookingForward(currentMember.id, draft, null);
    setEditing(false);
  }

  return (
    <Card className="overflow-hidden">
      {quoteOfTheDay ? (
        <div className="border-line border-b px-5 py-4">
          <p className="text-ink text-[15px] leading-relaxed font-medium text-balance">
            &ldquo;{quoteOfTheDay.quote_text}&rdquo;
          </p>
          {quoteOfTheDay.author ? (
            <p className="text-faint mt-1.5 text-xs">— {quoteOfTheDay.author}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-px sm:grid-cols-2">
        {/* ------------------------------------------- next thing on the calendar */}
        <div className="px-5 py-4">
          <h3 className="text-muted mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
            To look forward to
          </h3>
          {nextEvent ? (
            <div>
              <p className="text-sm font-semibold">{nextEvent.event.title}</p>
              <p className="text-muted mt-0.5 text-xs">
                {formatDayLabel(nextEvent.at)} · {formatTime(nextEvent.at)}
                {nextEvent.event.location ? ` · ${nextEvent.event.location}` : ""}
              </p>
              <p className="text-accent mt-1.5 text-xs font-semibold">
                {countdownLabel(daysUntil(nextEvent.at))}
              </p>
            </div>
          ) : (
            <p className="text-faint text-xs">
              Nothing on the board yet — plan something on the Events tab.
            </p>
          )}
        </div>

        {/* ---------------------------------------------- personal notes */}
        <div className="border-line px-5 py-4 sm:border-l">
          <h3 className="text-muted mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
            What you&rsquo;re excited about
          </h3>

          {editing ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") setEditing(false);
                }}
                maxLength={160}
                placeholder="Seeing my friends on the weekend…"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  className="bg-ink text-on-ink rounded-lg px-3 py-1.5 text-xs font-medium"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-muted px-2 py-1.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraft(mine?.note ?? "");
                setEditing(true);
              }}
              disabled={!currentMember}
              className="text-left text-sm disabled:opacity-50"
            >
              {mine ? (
                <span className="text-ink">{mine.note}</span>
              ) : (
                <span className="text-faint">Add something &rarr;</span>
              )}
            </button>
          )}

          {others.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-dashed pt-3">
              {others.map((m) => {
                const note = noteFor(m.id)!;
                return (
                  <li key={m.id} className="flex items-start gap-2 text-xs">
                    <Avatar member={m} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span
                        className="rounded px-1 font-medium"
                        style={{ backgroundColor: tint(m.color, 0.14), color: m.color }}
                      >
                        {m.name}
                      </span>{" "}
                      <span className="text-muted">{note.note}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
