"use client";

import { useCallback, useMemo, useState } from "react";
import { useCalendarEntries } from "@/hooks/useCalendarEntries";
import { useCalendarAutoSync } from "@/hooks/useCalendarFeeds";
import { useEvents } from "@/hooks/useEvents";
import {
  addDays,
  dayKey,
  format,
  formatDayLabel,
  formatTime,
  isSameDay,
  parseDayKey,
  parseISO,
  toLocalInputValue,
} from "@/lib/dates";
import { CALENDAR_CATEGORIES, tint } from "@/lib/palette";
import type { AgendaItem, CalendarEntry, EventRsvp, FamilyEvent } from "@/lib/types";
import { CalendarFeeds } from "./CalendarFeeds";
import { useFamily } from "./FamilyProvider";
import { TodayCard } from "./TodayCard";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  inputClass,
} from "./ui";

/** How far ahead each range option looks. */
const RANGES = [
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "4w", label: "4 weeks", days: 28 },
  { id: "3m", label: "3 months", days: 92 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/** `null` is the "Everyone" tab. */
type PersonFilter = string | null;

/**
 * Flattens the two sources — posted events and personal/imported schedule
 * entries — into one list the agenda can lay out uniformly. Chores used to be
 * a third source; the feature is gone, and with it the only item kind that had
 * no time of day of its own.
 */
function buildAgenda(
  events: FamilyEvent[],
  rsvps: EventRsvp[],
  entries: CalendarEntry[],
): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const e of events) {
    const start = parseISO(e.event_date);
    const going = rsvps
      .filter((r) => r.event_id === e.id && r.status === "going")
      .map((r) => r.member_id);
    items.push({
      id: `event:${e.id}`,
      kind: "event",
      title: e.title,
      subtitle: e.location,
      day: dayKey(start),
      start,
      end: null,
      // Fall back to the poster so the dot still has a colour before any RSVP.
      memberIds: going.length ? going : e.created_by ? [e.created_by] : [],
    });
  }

  for (const c of entries) {
    const start = parseISO(c.start_time);
    items.push({
      id: `entry:${c.id}`,
      kind: "entry",
      title: c.title,
      subtitle: c.category === "general" ? null : c.category,
      day: dayKey(start),
      // All-day imports have no meaningful clock time.
      start: c.all_day ? null : start,
      end: c.all_day ? null : c.end_time ? parseISO(c.end_time) : null,
      memberIds: c.member_id ? [c.member_id] : [],
      allDay: c.all_day,
      readOnly: Boolean(c.source_feed_id),
    });
  }

  return items.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (!a.start) return b.start ? -1 : 0; // all-day first
    if (!b.start) return 1;
    return a.start.getTime() - b.start.getTime();
  });
}

/**
 * Does this item belong on `person`'s tab?
 *
 * An event nobody has claimed yet is household-wide, so it stays visible on
 * every tab — otherwise "Dad's schedule" would silently hide the trip the
 * whole family is going on. A personal entry with no owner is a data quirk
 * rather than a household item, so it only shows under Everyone.
 */
function belongsTo(item: AgendaItem, person: PersonFilter): boolean {
  if (person === null) return true;
  if (item.memberIds.includes(person)) return true;
  return item.kind === "event" && item.memberIds.length === 0;
}

/* ------------------------------------------------------------- Agenda row */

const KIND_ICON = { event: "🎟️", entry: "•" } as const;

function AgendaRow({
  item,
  onDelete,
}: {
  item: AgendaItem;
  onDelete: (() => void) | null;
}) {
  const { byId } = useFamily();
  const owners = item.memberIds.map((id) => byId[id]).filter(Boolean);
  const color = owners[0]?.color ?? "#a8a29e";

  return (
    <li className="group hover:bg-sunk/50 flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors">
      {/* A colour bar reads faster than a dot at a glance across the kitchen. */}
      <span
        className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />

      <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold tabular-nums">
        {item.start ? (
          formatTime(item.start)
        ) : (
          <span className="text-faint font-medium">All day</span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <span className="mr-1.5 text-xs" aria-hidden>
            {KIND_ICON[item.kind]}
          </span>
          {item.title}
        </p>
        <p className="text-faint mt-0.5 text-xs">
          {item.end ? `until ${formatTime(item.end)}` : null}
          {item.end && item.subtitle ? " · " : null}
          {item.subtitle}
          {(item.end || item.subtitle) && owners.length ? " · " : null}
          {owners.map((o) => o.name).join(", ")}
        </p>
      </div>

      <span className="flex shrink-0 -space-x-1.5 pt-0.5">
        {owners.slice(0, 3).map((o) => (
          <span key={o.id} className="ring-surface rounded-full ring-2">
            <Avatar member={o} size="sm" />
          </span>
        ))}
      </span>

      {onDelete ? (
        <button
          onClick={onDelete}
          className="text-faint hover:bg-danger-soft hover:text-danger h-7 w-7 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          aria-label={`Delete ${item.title}`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------- Tab */

export function CalendarTab() {
  const { members, currentMember } = useFamily();

  const [person, setPerson] = useState<PersonFilter>(null);
  const [range, setRange] = useState<RangeId>("4w");
  const [open, setOpen] = useState(false);
  const [feedsOpen, setFeedsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { events, rsvps, error: eventsError } = useEvents();
  const {
    entries,
    error: entriesError,
    createEntry,
    deleteEntry,
    reload: reloadEntries,
  } = useCalendarEntries();

  // Subscribed iCal feeds refresh themselves in the background; entries reload
  // whenever a run brings something new in.
  const onSynced = useCallback(() => void reloadEntries(), [reloadEntries]);
  const { lastSyncedAt } = useCalendarAutoSync(onSynced);

  const [form, setForm] = useState(() => ({
    member_id: "",
    title: "",
    start_time: toLocalInputValue(new Date()),
    end_time: "",
    category: "general" as string,
  }));

  const days = RANGES.find((r) => r.id === range)!.days;

  // Pinned per render pass rather than per keystroke: both bounds are derived
  // from one clock read so an item can never fall between them.
  const { fromKey, toKey } = useMemo(() => {
    const now = new Date();
    return { fromKey: dayKey(now), toKey: dayKey(addDays(now, days)) };
  }, [days]);

  const agenda = useMemo(
    () => buildAgenda(events, rsvps, entries),
    [events, rsvps, entries],
  );

  /** Everything ahead of us in the window, before the person filter. */
  const upcoming = useMemo(
    () => agenda.filter((i) => i.day >= fromKey && i.day <= toKey),
    [agenda, fromKey, toKey],
  );

  // Tab counts come from `upcoming`, not the filtered list, so each tab
  // advertises what it holds rather than what is currently shown.
  const countFor = useCallback(
    (p: PersonFilter) => upcoming.filter((i) => belongsTo(i, p)).length,
    [upcoming],
  );

  const visible = useMemo(
    () => upcoming.filter((i) => belongsTo(i, person)),
    [upcoming, person],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const i of visible) {
      const bucket = map.get(i.day);
      if (bucket) bucket.push(i);
      else map.set(i.day, [i]);
    }
    // `visible` is already sorted by day, so insertion order is chronological.
    return [...map.entries()];
  }, [visible]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const ok = await createEntry({
      // Adding from a person's tab defaults the entry to that person.
      member_id: form.member_id || person || currentMember?.id || null,
      title: form.title.trim(),
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      category: form.category,
    });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setForm((f) => ({ ...f, title: "", end_time: "" }));
    }
  }

  const activePerson = person ? members.find((m) => m.id === person) : null;
  const error = eventsError ?? entriesError;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <TodayCard />

      {/* ----------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {activePerson ? `${activePerson.name}'s schedule` : "What's coming up"}
          </h2>
          <p className="text-faint mt-0.5 text-xs">
            Next {RANGES.find((r) => r.id === range)!.label}
            {lastSyncedAt
              ? ` · feeds synced ${format(new Date(lastSyncedAt), "h:mm a")}`
              : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-sunk inline-flex rounded-xl p-1" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  range === r.id ? "bg-surface text-ink shadow-sm" : "text-muted"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setFeedsOpen(true)}>
            Feeds
          </Button>
          <Button onClick={() => setOpen(true)}>+ Add</Button>
        </div>
      </div>

      {/* -------------------------------------------------------- person tabs */}
      <div
        className="scroll-area -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label="Whose schedule"
      >
        <button
          role="tab"
          aria-selected={person === null}
          onClick={() => setPerson(null)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
            person === null
              ? "border-ink bg-ink text-on-ink"
              : "border-line bg-surface text-muted hover:bg-sunk"
          }`}
        >
          <span aria-hidden>👪</span>
          Everyone
          <span className="text-[11px] tabular-nums opacity-70">{countFor(null)}</span>
        </button>

        {members.map((m) => {
          const active = person === m.id;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={active}
              onClick={() => setPerson(active ? null : m.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "text-ink" : "border-line bg-surface text-muted hover:bg-sunk"
              }`}
              style={
                active
                  ? { borderColor: m.color, backgroundColor: tint(m.color, 0.14) }
                  : undefined
              }
            >
              <Avatar member={m} size="sm" ring={active} />
              {m.name}
              <span className="text-[11px] tabular-nums opacity-70">{countFor(m.id)}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ agenda */}
      {byDay.length === 0 ? (
        <Card>
          <EmptyState
            icon="🗓️"
            title={
              activePerson
                ? `Nothing on ${activePerson.name}'s calendar`
                : "Nothing coming up"
            }
            hint={
              activePerson
                ? "Add something, or connect their calendar feed so it fills in automatically."
                : "Add an entry, or subscribe to everyone's calendar under Feeds."
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {byDay.map(([key, items]) => {
            const date = parseDayKey(key);
            const today = isSameDay(date, new Date());
            return (
              // The day heading sticks to the page, not to the card. It must
              // therefore live *outside* any `overflow-hidden` ancestor —
              // that property makes an element a scroll container, and a
              // sticky child would then offset itself inside the card and sit
              // on top of the first row instead of tracking the page.
              <section key={key}>
                <div
                  className={`bg-canvas/90 sticky top-14 z-10 flex items-baseline gap-2 px-2 py-2 backdrop-blur ${
                    today ? "text-accent" : ""
                  }`}
                >
                  <h3 className="text-sm font-semibold">{formatDayLabel(date)}</h3>
                  <span className="text-faint text-xs">{format(date, "MMM d")}</span>
                  <span className="text-faint ml-auto text-xs tabular-nums">
                    {items.length}
                  </span>
                </div>
                <Card>
                  <ul className="p-2">
                    {items.map((i) => (
                      <AgendaRow
                        key={i.id}
                        item={i}
                        // Feed imports resync, so removing one here is
                        // pointless; events are managed on their own tab.
                        onDelete={
                          i.kind === "entry" && !i.readOnly
                            ? () => void deleteEntry(i.id.replace("entry:", ""))
                            : null
                        }
                      />
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}

      <CalendarFeeds
        open={feedsOpen}
        onClose={() => setFeedsOpen(false)}
        onSynced={reloadEntries}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Add to the calendar">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Who's it for?">
            <select
              value={form.member_id || person || currentMember?.id || ""}
              onChange={(e) => setForm({ ...form, member_id: e.target.value })}
              className={inputClass}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.avatar_emoji} {m.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="What">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Dentist appointment"
              maxLength={120}
              required
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Ends" hint="Optional">
              <input
                type="datetime-local"
                value={form.end_time}
                min={form.start_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputClass}
            >
              {CALENDAR_CATEGORIES.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
