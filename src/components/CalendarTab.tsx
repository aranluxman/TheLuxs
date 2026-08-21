"use client";

import { useMemo, useState } from "react";
import { useCalendarEntries } from "@/hooks/useCalendarEntries";
import { useChores } from "@/hooks/useChores";
import { useEvents } from "@/hooks/useEvents";
import {
  addDays,
  dayKey,
  format,
  formatDayLabel,
  formatTime,
  isSameDay,
  monthGridDays,
  parseISO,
  startOfWeekMon,
  toLocalInputValue,
  weekDays,
} from "@/lib/dates";
import { CALENDAR_CATEGORIES, tint } from "@/lib/palette";
import type { AgendaItem, CalendarEntry, Chore, EventRsvp, FamilyEvent } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  SectionTitle,
  inputClass,
} from "./ui";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Flattens the three sources — posted events, personal schedule entries and
 * chore deadlines — into one list the calendar can lay out uniformly.
 */
function buildAgenda(
  events: FamilyEvent[],
  rsvps: EventRsvp[],
  entries: CalendarEntry[],
  chores: Chore[],
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
      start,
      end: c.end_time ? parseISO(c.end_time) : null,
      memberIds: c.member_id ? [c.member_id] : [],
    });
  }

  for (const c of chores) {
    items.push({
      id: `chore:${c.id}`,
      kind: "chore",
      title: c.title,
      subtitle: c.recurrence_type === "weekly" ? "weekly chore" : "chore",
      day: c.due_date,
      start: null, // deadlines are all-day
      end: null,
      memberIds: c.assigned_member_id ? [c.assigned_member_id] : [],
      done: c.is_completed,
    });
  }

  return items.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (!a.start) return b.start ? -1 : 0; // all-day first
    if (!b.start) return 1;
    return a.start.getTime() - b.start.getTime();
  });
}

const KIND_ICON = { event: "🎟️", entry: "•", chore: "🧽" } as const;

function AgendaRow({ item }: { item: AgendaItem }) {
  const { byId } = useFamily();
  const owners = item.memberIds.map((id) => byId[id]).filter(Boolean);
  const color = owners[0]?.color ?? "#a8a29e";

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${item.done ? "text-faint line-through" : "font-medium"}`}>
          <span className="mr-1.5 text-xs" aria-hidden>
            {KIND_ICON[item.kind]}
          </span>
          {item.title}
        </p>
        <p className="text-faint text-xs">
          {item.start ? formatTime(item.start) : "All day"}
          {item.end ? `–${formatTime(item.end)}` : ""}
          {item.subtitle ? ` · ${item.subtitle}` : ""}
          {owners.length ? ` · ${owners.map((o) => o.name).join(", ")}` : ""}
        </p>
      </div>
    </li>
  );
}

export function CalendarTab() {
  const { members, currentMember } = useFamily();
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<Date>(() => new Date());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // The chore query window follows whichever grid is on screen.
  const grid = useMemo(
    () => (view === "month" ? monthGridDays(anchor) : weekDays(anchor)),
    [view, anchor],
  );
  const fromKey = dayKey(grid[0]);
  const toKey = dayKey(grid[grid.length - 1]);

  const { events, rsvps, error: eventsError } = useEvents();
  const { entries, error: entriesError, createEntry, deleteEntry } = useCalendarEntries();
  const { chores, error: choresError } = useChores(fromKey, toKey);

  const [form, setForm] = useState(() => ({
    member_id: "",
    title: "",
    start_time: toLocalInputValue(new Date()),
    end_time: "",
    category: "general" as string,
  }));

  const agenda = useMemo(
    () => buildAgenda(events, rsvps, entries, chores),
    [events, rsvps, entries, chores],
  );

  const filtered = useMemo(
    () =>
      agenda.filter(
        (i) =>
          // Items with no owner (an event nobody claimed) always stay visible.
          i.memberIds.length === 0 || i.memberIds.some((id) => !hidden.has(id)),
      ),
    [agenda, hidden],
  );

  const byDay = useMemo(() => {
    const map: Record<string, AgendaItem[]> = {};
    for (const i of filtered) (map[i.day] ??= []).push(i);
    return map;
  }, [filtered]);

  const selectedKey = dayKey(selected);
  const monthLabel = format(anchor, view === "month" ? "MMMM yyyy" : "MMMM yyyy");

  function shift(delta: number) {
    const next =
      view === "month"
        ? new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
        : addDays(startOfWeekMon(anchor), delta * 7);
    setAnchor(next);
  }

  function toggleMember(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const ok = await createEntry({
      member_id: form.member_id || currentMember?.id || null,
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

  const error = eventsError ?? entriesError ?? choresError;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="border-line hover:bg-sunk grid h-9 w-9 place-items-center rounded-xl border"
            aria-label="Previous"
          >
            ‹
          </button>
          <h2 className="min-w-[9.5rem] text-center text-lg font-semibold">{monthLabel}</h2>
          <button
            onClick={() => shift(1)}
            className="border-line hover:bg-sunk grid h-9 w-9 place-items-center rounded-xl border"
            aria-label="Next"
          >
            ›
          </button>
          <button
            onClick={() => {
              setAnchor(new Date());
              setSelected(new Date());
            }}
            className="text-muted hover:text-ink ml-1 text-sm"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-sunk inline-flex rounded-xl p-1">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                  view === v ? "bg-surface text-ink shadow-sm" : "text-muted"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button onClick={() => setOpen(true)}>+ Add</Button>
        </div>
      </div>

      {/* Colour key doubles as a per-member filter. */}
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const off = hidden.has(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggleMember(m.id)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity ${
                off ? "opacity-40" : ""
              }`}
              style={{ backgroundColor: tint(m.color, 0.14), color: m.color }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
              {m.name}
            </button>
          );
        })}
      </div>

      {view === "month" ? (
        <Card className="overflow-hidden">
          <div className="border-line text-muted grid grid-cols-7 border-b text-center text-[11px] font-semibold">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((d) => {
              const key = dayKey(d);
              const items = byDay[key] ?? [];
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = isSameDay(d, new Date());
              const isSelected = key === selectedKey;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(d)}
                  className={`border-line hover:bg-sunk/60 min-h-[4.5rem] border-r border-b p-1.5 text-left transition-colors last:border-r-0 ${
                    inMonth ? "" : "bg-sunk/30"
                  } ${isSelected ? "bg-sunk" : ""}`}
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                      isToday ? "bg-ink font-semibold text-white" : ""
                    } ${inMonth ? "" : "text-faint"}`}
                  >
                    {format(d, "d")}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-0.5">
                    {items.slice(0, 4).map((i) => (
                      <span
                        key={i.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          backgroundColor: i.memberIds[0]
                            ? (members.find((m) => m.id === i.memberIds[0])?.color ?? "#a8a29e")
                            : "#a8a29e",
                          opacity: i.done ? 0.35 : 1,
                        }}
                      />
                    ))}
                    {items.length > 4 ? (
                      <span className="text-faint text-[9px] leading-none">
                        +{items.length - 4}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {grid.map((d) => {
            const key = dayKey(d);
            const items = byDay[key] ?? [];
            return (
              <Card key={key} className="px-4 py-3">
                <p
                  className={`mb-1 text-sm font-semibold ${
                    isSameDay(d, new Date()) ? "text-accent" : ""
                  }`}
                >
                  {formatDayLabel(d)}
                </p>
                {items.length === 0 ? (
                  <p className="text-faint text-xs">Nothing scheduled</p>
                ) : (
                  <ul className="divide-line divide-y">
                    {items.map((i) => (
                      <AgendaRow key={i.id} item={i} />
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {view === "month" ? (
        <section>
          <SectionTitle>{formatDayLabel(selected)}</SectionTitle>
          <Card className="px-4 py-2">
            {(byDay[selectedKey] ?? []).length === 0 ? (
              <EmptyState icon="🗓️" title="Nothing scheduled" />
            ) : (
              <ul className="divide-line divide-y">
                {(byDay[selectedKey] ?? []).map((i) => (
                  <div key={i.id} className="flex items-center gap-2">
                    <div className="flex-1">
                      <AgendaRow item={i} />
                    </div>
                    {i.kind === "entry" ? (
                      <button
                        onClick={() => deleteEntry(i.id.replace("entry:", ""))}
                        className="text-faint h-7 w-7 shrink-0 rounded-full hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete ${i.title}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </ul>
            )}
          </Card>
        </section>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="Add to the calendar">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Who's it for?">
            <select
              value={form.member_id || currentMember?.id || ""}
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
