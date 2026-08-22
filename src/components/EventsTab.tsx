"use client";

import { useMemo, useState } from "react";
import { useEvents } from "@/hooks/useEvents";
import { format, formatDayLabel, formatTime, parseISO, toLocalInputValue } from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { EventRsvp, FamilyEvent, RsvpStatus } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  SectionTitle,
  inputClass,
} from "./ui";

const STATUS_BADGE: Record<RsvpStatus, string> = {
  going: "✓",
  maybe: "?",
  not_going: "✕",
};

const STATUS_LABEL: Record<RsvpStatus, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Can't",
};

function EventCard({
  event,
  rsvps,
  onSetRsvp,
  onDelete,
  past,
}: {
  event: FamilyEvent;
  rsvps: EventRsvp[];
  onSetRsvp: (status: RsvpStatus | null) => void;
  onDelete: () => void;
  past: boolean;
}) {
  const { members, byId, currentMember } = useFamily();
  const when = parseISO(event.event_date);
  const creator = event.created_by ? byId[event.created_by] : null;
  const byMember = useMemo(
    () => Object.fromEntries(rsvps.map((r) => [r.member_id, r.status])),
    [rsvps],
  );
  const mine = currentMember ? byMember[currentMember.id] : undefined;
  const goingCount = rsvps.filter((r) => r.status === "going").length;

  return (
    <Card className={`overflow-hidden ${past ? "opacity-60" : ""}`}>
      <div className="flex gap-4 p-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl"
          style={{ backgroundColor: tint(creator?.color ?? "#b45309", 0.14) }}
        >
          <div className="text-center leading-none">
            <div className="text-muted text-[10px] font-semibold tracking-wide uppercase">
              {format(when, "MMM")}
            </div>
            <div className="text-lg font-semibold">{format(when, "d")}</div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{event.title}</h3>
          <p className="text-muted mt-0.5 text-sm">
            {formatDayLabel(when)} · {formatTime(when)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          {event.description ? (
            <p className="text-muted mt-2 text-sm whitespace-pre-line">{event.description}</p>
          ) : null}
          {creator ? (
            <p className="text-faint mt-2 text-xs">Posted by {creator.name}</p>
          ) : null}
        </div>

        <button
          onClick={onDelete}
          className="text-faint h-8 w-8 shrink-0 rounded-full text-lg hover:bg-red-50 hover:text-red-700"
          aria-label={`Delete ${event.title}`}
          title="Delete event"
        >
          ×
        </button>
      </div>

      <div className="border-line bg-sunk/40 border-t px-4 py-3">
        <p className="text-muted mb-2 text-xs font-semibold">
          {goingCount > 0 ? `${goingCount} coming` : "Nobody has RSVP'd yet"}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {members.map((m) => {
            const status = byMember[m.id] as RsvpStatus | undefined;
            return (
              <span key={m.id} className="relative inline-flex">
                <span className={status ? "" : "opacity-35 grayscale"}>
                  <Avatar member={m} size="sm" />
                </span>
                {status ? (
                  <span
                    className="bg-surface absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold"
                    style={{
                      color:
                        status === "going"
                          ? "#16a34a"
                          : status === "maybe"
                            ? "#ca8a04"
                            : "#b91c1c",
                    }}
                    title={`${m.name}: ${STATUS_LABEL[status]}`}
                  >
                    {STATUS_BADGE[status]}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>

        {currentMember && !past ? (
          <div className="mt-3 flex gap-1.5">
            {(Object.keys(STATUS_LABEL) as RsvpStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => onSetRsvp(mine === s ? null : s)}
                aria-pressed={mine === s}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  mine === s
                    ? "bg-ink text-white"
                    : "border-line bg-surface text-muted hover:bg-sunk border"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function EventsTab() {
  const { currentMember } = useFamily();
  const { events, rsvps, loading, error, createEvent, deleteEvent, setRsvp } = useEvents();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    title: "",
    event_date: toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    location: "",
    description: "",
  }));

  // Pinned once per mount: a clock read during render is impure, and an event
  // should not hop between the two lists mid-session anyway.
  const [now] = useState(() => Date.now());
  const { upcoming, past } = useMemo(() => {
    const up: FamilyEvent[] = [];
    const old: FamilyEvent[] = [];
    for (const e of events) {
      (parseISO(e.event_date).getTime() >= now ? up : old).push(e);
    }
    return { upcoming: up, past: old.reverse() };
  }, [events, now]);

  const rsvpsFor = (id: string) => rsvps.filter((r) => r.event_id === id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const ok = await createEvent({
      title: form.title.trim(),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      // datetime-local has no zone; the Date constructor reads it as local time.
      event_date: new Date(form.event_date).toISOString(),
      created_by: currentMember?.id ?? null,
    });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setForm({
        title: "",
        event_date: toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        location: "",
        description: "",
      });
    }
  }

  return (
    <div className="space-y-8">
      <ErrorNote message={error} />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Activity board</h2>
          <p className="text-muted mt-0.5 text-sm">Plan something for the whole house.</p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New</Button>
      </div>

      <section>
        <SectionTitle>Upcoming</SectionTitle>
        {loading ? (
          <Card>
            <p className="text-muted px-4 py-6 text-sm">Loading…</p>
          </Card>
        ) : upcoming.length === 0 ? (
          <Card>
            <EmptyState
              icon="🎡"
              title="Nothing planned yet"
              hint="Movie night, a trip downtown, the CNE — put it on the board and let everyone RSVP."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {upcoming.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                past={false}
                rsvps={rsvpsFor(e.id)}
                onSetRsvp={(s) => currentMember && setRsvp(e.id, currentMember.id, s)}
                onDelete={() => deleteEvent(e.id)}
              />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <SectionTitle>Already happened</SectionTitle>
          <div className="space-y-3">
            {past.slice(0, 10).map((e) => (
              <EventCard
                key={e.id}
                event={e}
                past
                rsvps={rsvpsFor(e.id)}
                onSetRsvp={() => {}}
                onDelete={() => deleteEvent(e.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="New family event">
        <form onSubmit={submit} className="space-y-4">
          <Field label="What is it?">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Movie night"
              maxLength={120}
              required
              className={inputClass}
            />
          </Field>

          <Field label="When">
            <input
              type="datetime-local"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              required
              className={inputClass}
            />
          </Field>

          <Field label="Where">
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Scotiabank Theatre"
              className={inputClass}
            />
          </Field>

          <Field label="Details">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Anything else the family should know."
              className={inputClass}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Posting…" : "Post event"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
