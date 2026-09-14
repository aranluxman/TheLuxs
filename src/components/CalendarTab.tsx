"use client";

import { useCallback, useMemo, useState } from "react";
import { useCalendarEntries } from "@/hooks/useCalendarEntries";
import { usePrefs } from "@/hooks/usePrefs";
import { useCalendarAutoSync } from "@/hooks/useCalendarFeeds";
import { useEvents } from "@/hooks/useEvents";
import {
  addDays,
  addMonths,
  addWeeks,
  dayKey,
  format,
  formatDayLabel,
  formatTime,
  isSameDay,
  isSameMonth,
  monthGridDays,
  parseDayKey,
  parseISO,
  startOfMonth,
  startOfWeekMon,
  toLocalInputValue,
  weekDaysOf,
} from "@/lib/dates";
import { CALENDAR_CATEGORIES, categoryStyle, tint } from "@/lib/palette";
import type { AgendaItem, CalendarEntry, EventRsvp, FamilyEvent } from "@/lib/types";
import { CalendarFeeds } from "./CalendarFeeds";
import { useFamily } from "./FamilyProvider";
import { PhotoWall } from "./PhotoWall";
import { TodayCard } from "./TodayCard";
import { WeatherCard } from "./WeatherCard";
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
  // `short` is what a 390px phone shows: the full labels wrapped onto two
  // lines each, turning the segmented control into a three-storey block.
  { id: "2w", label: "2 weeks", short: "2w", days: 14 },
  { id: "4w", label: "4 weeks", short: "4w", days: 28 },
  { id: "3m", label: "3 months", short: "3m", days: 92 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/**
 * Days of agenda shown before the Load more button, and how many each press
 * adds. Counted in *days that have something on them* rather than calendar
 * days: a run of empty days renders nothing, so paging by calendar date would
 * hand back a button that reveals blank space.
 */
const DAYS_PER_PAGE = 3;

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
      location: e.location,
      description: e.description,
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
      category: c.category,
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

/* ---------------------------------------------------------- Detail sheet */

/** "1h 15m", "45m", "2h" — omitted entirely when there is no end time. */
function formatSpan(start: Date, end: Date): string | null {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** One labelled line. Renders nothing at all when there is no value. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="border-line/70 flex gap-3 border-t py-2.5 first:border-t-0 first:pt-0">
      <span className="text-faint w-20 shrink-0 text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

/**
 * Everything the agenda row had to leave out.
 *
 * The row is one line on a phone, so it truncates the title and drops the date,
 * the duration, the category in words and — for a posted event — the location
 * and notes, which had no home anywhere in the app after the Events tab was
 * removed. Tapping a row is now the way to see any of it.
 */
function EventDetailSheet({
  item,
  onClose,
  onDelete,
}: {
  item: AgendaItem | null;
  onClose: () => void;
  onDelete: (() => void) | null;
}) {
  const { byId } = useFamily();
  if (!item) return null;

  const owners = item.memberIds.map((id) => byId[id]).filter(Boolean);
  const glyph = rowGlyph(item);
  const day = parseDayKey(item.day);
  const span = item.start && item.end ? formatSpan(item.start, item.end) : null;

  return (
    <Modal open onClose={onClose} title="Event details">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base"
          style={{ backgroundColor: tint(glyph.hue, 0.16) }}
          aria-hidden
        >
          {glyph.icon}
        </span>
        {/* Wraps rather than truncating — seeing the whole title is half the
            reason for opening this at all. */}
        <h3 className="min-w-0 flex-1 text-base leading-snug font-semibold">{item.title}</h3>
      </div>

      <div className="mt-4">
        <DetailRow label="When">
          <p className="font-medium">{format(day, "EEEE, d MMMM yyyy")}</p>
          <p className="text-muted mt-0.5">
            {item.start ? (
              <>
                {formatTime(item.start)}
                {item.end ? ` – ${formatTime(item.end)}` : null}
                {span ? <span className="text-faint"> · {span}</span> : null}
              </>
            ) : (
              "All day"
            )}
          </p>
        </DetailRow>

        <DetailRow label="Type">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>{glyph.icon}</span>
            {glyph.label}
          </span>
        </DetailRow>

        <DetailRow label={owners.length > 1 ? "Who" : "Whose"}>
          {owners.length ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {owners.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1.5">
                  <Avatar member={o} size="sm" />
                  {o.name}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-faint">Nobody in particular — this one is the whole house.</span>
          )}
        </DetailRow>

        {/* Events only, and only when they carry them. An imported entry has
            neither column, so these two simply never render for one. */}
        <DetailRow label="Where">{item.location || null}</DetailRow>
        <DetailRow label="Notes">
          {item.description ? (
            <p className="whitespace-pre-wrap">{item.description}</p>
          ) : null}
        </DetailRow>

        {item.readOnly ? (
          <DetailRow label="Source">
            <p className="text-muted">
              Imported from a subscribed calendar, so it cannot be edited or deleted here
              — the next sync would only bring it back. Remove the feed under{" "}
              <span className="text-ink font-medium">Feeds</span> to take its events with it.
            </p>
          </DetailRow>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {onDelete ? (
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Agenda row */

const KIND_ICON = { event: "🎟️", entry: "•" } as const;

/**
 * An entry's icon comes from its category; an event keeps the ticket glyph,
 * because "event" is a kind rather than a category and reads as its own thing.
 */
function rowGlyph(item: AgendaItem): { icon: string; label: string; hue: string } {
  if (item.kind === "event") {
    return { icon: KIND_ICON.event, label: "Event", hue: "#b45309" };
  }
  return categoryStyle(item.subtitle);
}

function AgendaRow({
  item,
  onOpen,
  onDelete,
}: {
  item: AgendaItem;
  onOpen: () => void;
  onDelete: (() => void) | null;
}) {
  const { byId } = useFamily();
  const owners = item.memberIds.map((id) => byId[id]).filter(Boolean);
  const color = owners[0]?.color ?? "#a8a29e";
  const glyph = rowGlyph(item);

  return (
    <li className="group hover:bg-sunk/50 flex items-start rounded-xl transition-[background-color,transform] hover:translate-x-px">
      {/* The row itself is the button. The delete control sits outside it —
          nesting one button inside another is invalid, and on a phone there is
          no hover to reveal it anyway, which is exactly why the sheet this
          opens carries its own Delete. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-3 text-left"
        aria-label={`${item.title} — see details`}
      >
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
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px]"
            style={{ backgroundColor: tint(glyph.hue, 0.16) }}
            title={glyph.label}
            aria-hidden
          >
            {glyph.icon}
          </span>
          <span className="min-w-0 truncate">{item.title}</span>
        </p>
        <p className="text-faint mt-0.5 text-xs">
          {/* Screen readers get the category as words; sighted users get the
              glyph above, so it is not repeated as text twice. */}
          <span className="sr-only">{glyph.label}. </span>
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
      </button>

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="text-faint hover:bg-danger-soft hover:text-danger mt-3 mr-2 h-7 w-7 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          aria-label={`Delete ${item.title}`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------- Grid view */

/**
 * The calendar as a calendar.
 *
 * The agenda list answers "what is on today and this week" — it is the right
 * shape for a phone and the wrong shape for "are we free the last weekend of
 * the month", which is a question about the *shape* of a month and needs to be
 * seen as one. So both exist, and the choice sits at the top where it can be
 * made in one tap.
 *
 * Spans a month or a single week. The week is not a smaller month: with seven
 * columns and one row it has the height to list every item in full, which is
 * what makes it the view for planning the week ahead rather than skimming it.
 */
const WEEKDAY_INITIALS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How many items a month cell shows before it gives up and counts them. */
const MONTH_CELL_LIMIT = 3;

function GridChip({ item, onOpen }: { item: AgendaItem; onOpen: () => void }) {
  const { byId } = useFamily();
  const owner = item.memberIds.map((id) => byId[id]).find(Boolean);
  const color = owner?.color ?? "#a8a29e";

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.start ? `${formatTime(item.start)} · ` : ""}${item.title}`}
      className="hover:bg-sunk flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {item.start ? (
        <span className="text-faint shrink-0 tabular-nums">{format(item.start, "h:mm")}</span>
      ) : null}
      <span className="min-w-0 truncate">{item.title}</span>
    </button>
  );
}

function CalendarGrid({
  span,
  anchor,
  itemsByDay,
  onOpen,
}: {
  span: "month" | "week";
  anchor: Date;
  itemsByDay: Map<string, AgendaItem[]>;
  onOpen: (item: AgendaItem) => void;
}) {
  const days = span === "month" ? monthGridDays(anchor) : weekDaysOf(anchor);
  const today = new Date();

  return (
    <Card className="overflow-hidden">
      <div className="border-line text-faint grid grid-cols-7 border-b text-center text-[10px] font-bold tracking-[0.08em] uppercase">
        {WEEKDAY_INITIALS.map((d) => (
          <span key={d} className="py-2">
            {/* Three letters do not fit seven columns on a 390px phone. */}
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = dayKey(date);
          const items = itemsByDay.get(key) ?? [];
          const isToday = isSameDay(date, today);
          // Only the month view has days that belong to a neighbouring month;
          // in the week view every cell is in the week by construction.
          const outside = span === "month" && !isSameMonth(date, anchor);
          const shown = span === "month" ? items.slice(0, MONTH_CELL_LIMIT) : items;

          return (
            <div
              key={key}
              className={`border-line min-h-24 border-t border-l p-1 first:border-l-0 ${
                span === "week" ? "sm:min-h-64" : ""
              } ${outside ? "bg-sunk/40" : ""}`}
            >
              <p
                className={`mb-0.5 px-1 text-[11px] font-semibold tabular-nums ${
                  isToday
                    ? "bg-accent text-on-ink inline-block rounded-full px-1.5"
                    : outside
                      ? "text-faint"
                      : "text-muted"
                }`}
              >
                {format(date, "d")}
              </p>

              <div className="space-y-0.5">
                {shown.map((i) => (
                  <GridChip key={i.id} item={i} onOpen={() => onOpen(i)} />
                ))}
                {items.length > shown.length ? (
                  <p className="text-faint px-1 text-[10px] font-semibold">
                    +{items.length - shown.length} more
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- Tab */

export function CalendarTab() {
  const { members, currentMember } = useFamily();

  const { prefs } = usePrefs();

  const [person, setPerson] = useState<PersonFilter>(null);
  const [range, setRange] = useState<RangeId>("4w");
  // Which view the tab opens on is a per-device setting, read once as the
  // initial value: changing it in Settings should not flip the calendar out
  // from under whoever is reading it, the same rule the start tab follows.
  const [view, setView] = useState<"list" | "grid">(() => prefs.calendarView);
  const [span, setSpan] = useState<"month" | "week">("month");
  /** Which month or week the grid is showing. The list view ignores it. */
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [visibleDays, setVisibleDays] = useState(DAYS_PER_PAGE);
  const [open, setOpen] = useState(false);
  const [feedsOpen, setFeedsOpen] = useState(false);
  /** The row whose details are on screen, or null. */
  const [detail, setDetail] = useState<AgendaItem | null>(null);
  const [saving, setSaving] = useState(false);

  const { events, rsvps, error: eventsError } = useEvents();
  const {
    entries,
    error: entriesError,
    createEntry,
    deleteEntry,
    reload: reloadEntries,
  } = useCalendarEntries();

  /**
   * Whether a row can be removed from here, and how.
   *
   * Feed imports resync, so deleting one locally would only bring it back on
   * the next run — the feed has to go instead. Events are posted rather than
   * scheduled and are not this tab's to remove. Defined once because both the
   * row's hover control and the detail sheet's Delete have to agree; two copies
   * of this rule is how one of them ends up offering a delete that no-ops.
   */
  const deleteFor = useCallback(
    (i: AgendaItem) =>
      i.kind === "entry" && !i.readOnly
        ? () => void deleteEntry(i.id.replace("entry:", ""))
        : null,
    [deleteEntry],
  );

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

  /**
   * The grid is not bounded by the range control: it shows a month or a week,
   * whichever the arrows have landed on, so it reads from the whole agenda
   * rather than from `upcoming`. That is also what lets it show the past — a
   * month view that blanked out everything before today would be a strange
   * thing to hand somebody.
   */
  const gridByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const i of agenda) {
      if (!belongsTo(i, person)) continue;
      const bucket = map.get(i.day);
      if (bucket) bucket.push(i);
      else map.set(i.day, [i]);
    }
    return map;
  }, [agenda, person]);

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

  // A different person or range is a different question, so it is answered
  // from the top rather than from however far the previous one was expanded.
  // Done in the handlers rather than an effect: the reset belongs to the
  // interaction, and deriving it from a render-phase comparison would be a
  // roundabout way of saying the same thing.
  function chooseRange(next: RangeId) {
    setRange(next);
    setVisibleDays(DAYS_PER_PAGE);
  }

  function choosePerson(next: PersonFilter) {
    setPerson(next);
    setVisibleDays(DAYS_PER_PAGE);
  }

  const shownDays = byDay.slice(0, visibleDays);
  const hiddenDayCount = byDay.length - shownDays.length;

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
    <div className="space-y-7">
      <ErrorNote message={error} />

      <TodayCard />

      {/* Directly under the date, because "what is it doing out there" is read
          in the same glance as "what day is it" on the way out of the door. */}
      <WeatherCard />

      {/* Above the agenda rather than below it. The schedule has the stronger
          claim on the fold, but a photo wall nobody scrolls to is a photo wall
          nobody posts to — and posting is the half of this that only works if
          people find it. */}
      {prefs.showPhotos ? <PhotoWall /> : null}

      {/* ----------------------------------------------------------- header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="rule-accent">
          <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Shared calendar</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            {activePerson ? `${activePerson.name}'s schedule` : "What's coming up"}
          </h2>
          <p className="text-faint mt-0.5 text-xs">
            {view === "grid"
              ? span === "month"
                ? format(anchor, "MMMM yyyy")
                : `Week of ${format(startOfWeekMon(anchor), "MMM d")}`
              : `Next ${RANGES.find((r) => r.id === range)!.label}`}
            {lastSyncedAt
              ? ` · feeds synced ${format(new Date(lastSyncedAt), "h:mm a")}`
              : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* List or grid, first: it changes what every other control in this
              row means, so it reads left to right as "how, then how much". */}
          <div className="bg-sunk inline-flex rounded-xl p-1 shadow-inner" role="group" aria-label="View">
            {(["list", "grid"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  view === v ? "bg-surface text-ink shadow-sm" : "text-muted"
                }`}
                aria-label={v === "list" ? "Show the agenda list" : "Show the calendar grid"}
              >
                <span aria-hidden>{v === "list" ? "☰ " : "▦ "}</span>
                {v === "list" ? "List" : "Grid"}
              </button>
            ))}
          </div>

          {view === "grid" ? (
            <div className="bg-sunk inline-flex rounded-xl p-1 shadow-inner" role="group" aria-label="How much at a time">
              {(["month", "week"] as const).map((sp) => (
                <button
                  key={sp}
                  onClick={() => setSpan(sp)}
                  aria-pressed={span === sp}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap capitalize transition-colors ${
                    span === sp ? "bg-surface text-ink shadow-sm" : "text-muted"
                  }`}
                >
                  {sp}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className={`bg-sunk rounded-xl p-1 shadow-inner ${view === "list" ? "inline-flex" : "hidden"}`}
            role="group"
            aria-label="Range"
          >
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => chooseRange(r.id)}
                aria-pressed={range === r.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  range === r.id ? "bg-surface text-ink shadow-sm" : "text-muted"
                }`}
                aria-label={`Show the next ${r.label}`}
              >
                <span className="sm:hidden">{r.short}</span>
                <span className="hidden sm:inline">{r.label}</span>
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
      {/* Wraps rather than scrolling sideways. A horizontal scroller hid
          members past the right edge on a phone — with five people the last
          chip sat ~430px off-screen — and it was also making the whole
          document horizontally scrollable, which dragged the fixed bottom nav
          out of reach. Two short rows of chips cost a few pixels of height and
          keep every member visible and tappable. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Whose schedule">
        <button
          role="tab"
          aria-selected={person === null}
          onClick={() => choosePerson(null)}
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
              onClick={() => choosePerson(active ? null : m.id)}
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
      {view === "grid" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setAnchor((d) => (span === "month" ? addMonths(d, -1) : addWeeks(d, -1)))
              }
              className="border-line bg-surface text-ink hover:bg-sunk grid h-9 w-9 place-items-center rounded-full border text-sm"
              aria-label={span === "month" ? "Previous month" : "Previous week"}
            >
              ‹
            </button>
            <button
              onClick={() =>
                setAnchor((d) => (span === "month" ? addMonths(d, 1) : addWeeks(d, 1)))
              }
              className="border-line bg-surface text-ink hover:bg-sunk grid h-9 w-9 place-items-center rounded-full border text-sm"
              aria-label={span === "month" ? "Next month" : "Next week"}
            >
              ›
            </button>
            <p className="text-sm font-semibold">
              {span === "month"
                ? format(anchor, "MMMM yyyy")
                : `${format(startOfWeekMon(anchor), "MMM d")} – ${format(
                    addDays(startOfWeekMon(anchor), 6),
                    "MMM d",
                  )}`}
            </p>
            <Button
              variant="ghost"
              className="ml-auto min-h-9 px-3 py-1.5 text-xs"
              onClick={() => setAnchor(new Date())}
            >
              Today
            </Button>
          </div>

          <CalendarGrid
            span={span}
            anchor={span === "month" ? startOfMonth(anchor) : anchor}
            itemsByDay={gridByDay}
            onOpen={setDetail}
          />

          <p className="text-faint text-xs">
            Tap anything to see the full details.
          </p>
        </div>
      ) : byDay.length === 0 ? (

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
          {shownDays.map(([key, items]) => {
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
                  className={`bg-canvas/90 sticky top-14 z-10 flex items-baseline gap-2 px-2 py-2.5 backdrop-blur ${
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
                        onOpen={() => setDetail(i)}
                        onDelete={deleteFor(i)}
                      />
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}

          {hiddenDayCount > 0 ? (
            <button
              onClick={() => setVisibleDays((n) => n + DAYS_PER_PAGE)}
              className="border-line bg-surface text-ink hover:bg-sunk dashboard-card w-full rounded-2xl border py-3.5 text-sm font-semibold transition-colors"
              // The two spans below sit flush in the accessibility tree
              // ("Load more5 more days"), so the spoken name is set here.
              aria-label={`Load more. ${hiddenDayCount} more ${
                hiddenDayCount === 1 ? "day" : "days"
              } with something scheduled.`}
            >
              Load more
              <span className="text-muted ml-1.5 font-medium">
                {hiddenDayCount} more {hiddenDayCount === 1 ? "day" : "days"}
              </span>
            </button>
          ) : null}
        </div>
      )}

      <EventDetailSheet
        item={detail}
        onClose={() => setDetail(null)}
        onDelete={detail ? deleteFor(detail) : null}
      />

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
