"use client";

import { useMemo, useRef, useState } from "react";
import { useTodos } from "@/hooks/useTodos";
import { addDays, dayKey, format, parseDayKey, todayKey } from "@/lib/dates";
import { tint } from "@/lib/palette";
import { formatEstimate, todoVisibleTo, type Todo } from "@/lib/types";
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

/* -------------------------------------------------------------- due dates */

/**
 * How a due date reads on a card.
 *
 * Compared as `YYYY-MM-DD` strings rather than as Date objects: `due_on` is a
 * calendar day, and turning it into an instant to subtract from another
 * instant is what makes a task flip to "overdue" at 7pm for anyone the wrong
 * side of a timezone.
 */
function dueLabel(dueOn: string): { text: string; tone: "overdue" | "soon" | "later" } {
  const today = todayKey();
  if (dueOn < today) return { text: "Overdue", tone: "overdue" };
  if (dueOn === today) return { text: "Today", tone: "soon" };

  if (dueOn === dayKey(addDays(new Date(), 1))) return { text: "Tomorrow", tone: "soon" };

  return { text: format(parseDayKey(dueOn), "EEE d MMM"), tone: "later" };
}

const DUE_TONE = {
  overdue: "text-danger",
  soon: "text-accent",
  later: "text-muted",
} as const;

/* ------------------------------------------------------------- estimates */

/**
 * The estimates worth one tap. Anything else is typed into the box beside
 * them — the point of the presets is that "half an hour" should not require
 * doing arithmetic in minutes.
 */
const ESTIMATE_PRESETS = [5, 15, 30, 60, 120] as const;

/* ----------------------------------------------------------- shared form */

/** What the add form and the edit sheet both hold. */
interface TodoDraft {
  title: string;
  assigneeIds: string[];
  dueOn: string;
  /** Kept as the string the input holds, so a half-typed number is not a 0. */
  estimate: string;
}

const EMPTY_DRAFT: TodoDraft = { title: "", assigneeIds: [], dueOn: "", estimate: "" };

function draftFrom(todo: Todo): TodoDraft {
  return {
    title: todo.title,
    assigneeIds: todo.assignee_ids,
    dueOn: todo.due_on ?? "",
    estimate: todo.estimate_minutes ? String(todo.estimate_minutes) : "",
  };
}

/** Minutes, or null. Anything unparseable or out of range is "nobody said". */
function estimateMinutes(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 10080);
}

/**
 * Who a task is for.
 *
 * Chips rather than a multi-select: a `<select multiple>` on a phone is a
 * scrolling box that needs a long press to add a second name, which is exactly
 * the interaction this screen exists to make easy. Nobody selected is the
 * whole house, so there is no "Everyone" chip to get out of sync with the
 * others — it is simply what an empty row means.
 */
function AssigneePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { members } = useFamily();

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const picked = value.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                onChange(picked ? value.filter((id) => id !== m.id) : [...value, m.id])
              }
              aria-pressed={picked}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs font-semibold transition-colors ${
                picked ? "text-ink" : "border-line text-muted hover:bg-sunk"
              }`}
              style={
                picked
                  ? { borderColor: m.color, backgroundColor: tint(m.color, 0.16) }
                  : undefined
              }
            >
              <Avatar member={m} size="xs" />
              {m.name}
            </button>
          );
        })}
      </div>
      <p className="text-faint mt-1.5 text-[11px]">
        {value.length === 0
          ? "Nobody picked — everyone in the house sees it."
          : "Only these people and you can see this task."}
      </p>
    </div>
  );
}

function EstimateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ESTIMATE_PRESETS.map((p) => {
        const active = value === String(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(active ? "" : String(p))}
            aria-pressed={active}
            className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
              active ? "border-ink bg-ink text-on-ink" : "border-line text-muted hover:bg-sunk"
            }`}
          >
            {formatEstimate(p)}
          </button>
        );
      })}
      <span className="inline-flex min-h-9 items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={10080}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="min"
          aria-label="How long it takes, in minutes"
          className={`${inputClass} w-24 py-1.5 tabular-nums`}
        />
        <span className="text-faint text-xs">min</span>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- edit sheet */

function EditSheet({
  todo,
  onClose,
  onSave,
}: {
  todo: Todo | null;
  onClose: () => void;
  onSave: (id: string, draft: TodoDraft) => Promise<boolean>;
}) {
  // Keyed on the task so opening a different row re-seeds the form rather than
  // showing the last one's values.
  const [draft, setDraft] = useState<TodoDraft>(() => (todo ? draftFrom(todo) : EMPTY_DRAFT));
  const [seeded, setSeeded] = useState(todo?.id ?? null);
  const [saving, setSaving] = useState(false);

  if (todo && seeded !== todo.id) {
    setSeeded(todo.id);
    setDraft(draftFrom(todo));
  }
  if (!todo) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!todo || !draft.title.trim()) return;
    setSaving(true);
    const ok = await onSave(todo.id, draft);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Edit this task">
      <form onSubmit={submit} className="space-y-4">
        <Field label="What needs doing">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={140}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Who it's for" hint="Leave empty for everyone">
          <AssigneePicker
            value={draft.assigneeIds}
            onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
          />
        </Field>

        <Field label="Done by" hint="Optional">
          <input
            type="date"
            value={draft.dueOn}
            onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="How long it takes" hint="Optional">
          <EstimateField
            value={draft.estimate}
            onChange={(estimate) => setDraft({ ...draft, estimate })}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !draft.title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------------- Row */

function TodoRow({
  todo,
  done,
  onToggle,
  onEdit,
  onRemove,
}: {
  todo: Todo;
  done: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { byId } = useFamily();
  // A member who has left the house leaves their id in the array; the map is
  // what decides whether there is still a person to draw.
  const assignees = todo.assignee_ids.map((id) => byId[id]).filter(Boolean);
  const due = todo.due_on ? dueLabel(todo.due_on) : null;
  const estimate = formatEstimate(todo.estimate_minutes);

  return (
    <li
      className="tick-row group hover:bg-sunk/50 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors"
      data-done={done}
    >
      {/* Same tick as the shopping list — the interaction is identical, so it
          should look and feel identical. See the .tick-* rules in globals.css. */}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={done} onChange={onToggle} className="peer sr-only" />
        <span
          className="tick-box peer-focus-visible:ring-accent/50 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
          data-done={done}
          aria-hidden
        >
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`tick-label block truncate text-sm ${
              done ? "text-faint line-through" : "font-medium"
            }`}
          >
            {todo.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {assignees.length ? (
              assignees.map((a) => (
                <span
                  key={a.id}
                  className="rounded px-1 font-medium"
                  style={{ backgroundColor: tint(a.color, 0.16), color: a.color }}
                >
                  {a.name}
                </span>
              ))
            ) : (
              <span className="text-faint">Everyone</span>
            )}
            {due ? (
              <>
                <span className="text-faint" aria-hidden>
                  ·
                </span>
                <span className={`font-medium ${done ? "text-faint" : DUE_TONE[due.tone]}`}>
                  {due.text}
                </span>
              </>
            ) : null}
            {estimate ? (
              <>
                <span className="text-faint" aria-hidden>
                  ·
                </span>
                <span className="text-muted inline-flex items-center gap-1 font-medium tabular-nums">
                  <span aria-hidden>⏱</span>
                  <span className="sr-only">Takes about </span>
                  {estimate}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </label>

      {assignees.length ? (
        <span className="hidden shrink-0 -space-x-1.5 opacity-70 sm:flex">
          {assignees.slice(0, 3).map((a) => (
            <span key={a.id} className="ring-surface rounded-full ring-2">
              <Avatar member={a} size="sm" decorative />
            </span>
          ))}
        </span>
      ) : null}

      {/* Both controls are always visible rather than revealed on hover: there
          is no hover on a phone, and this list is used almost entirely on
          phones. */}
      <button
        onClick={onEdit}
        aria-label={`Edit ${todo.title}`}
        title="Edit"
        className="text-faint hover:bg-sunk hover:text-ink grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm leading-none transition-colors"
      >
        ✏️
      </button>
      <button
        onClick={onRemove}
        aria-label={`Remove ${todo.title}`}
        className="text-faint hover:bg-danger-soft hover:text-danger grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none transition-colors"
      >
        ×
      </button>
    </li>
  );
}

/* --------------------------------------------------------------------- Tab */

export function TodosTab() {
  const { currentMember } = useFamily();
  const { todos, loading, error, addTodo, editTodo, setDone, removeTodo, clearDone } =
    useTodos();

  const [draft, setDraft] = useState<TodoDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const meId = currentMember?.id ?? null;

  const { open, done, openMinutes } = useMemo(() => {
    const o: Todo[] = [];
    const d: Todo[] = [];
    // A task naming particular people is theirs and its author's. Every
    // browser is still *sent* every row — see `todoVisibleTo` — so this is a
    // courtesy, and the README says as much.
    for (const t of todos) {
      if (!todoVisibleTo(t, meId)) continue;
      (t.done_at ? d : o).push(t);
    }
    // Open tasks by due date, undated last — a board is read as "what is
    // closest", and an undated task is by definition not close.
    o.sort((a, b) => {
      if (a.due_on !== b.due_on) {
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      }
      return a.created_at.localeCompare(b.created_at);
    });
    d.sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
    return {
      open: o,
      done: d,
      openMinutes: o.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0),
    };
  }, [todos, meId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setSaving(true);
    const ok = await addTodo(
      draft.title,
      draft.assigneeIds,
      draft.dueOn || null,
      meId,
      estimateMinutes(draft.estimate),
    );
    setSaving(false);
    if (ok) {
      // The people and the estimate are left as they were: adding three jobs
      // for the same person is the common case, and re-picking them each time
      // is friction. The title and the date are per-task and are cleared.
      setDraft((d) => ({ ...d, title: "", dueOn: "" }));
      titleRef.current?.focus();
    }
  }

  const totalEstimate = formatEstimate(openMinutes);

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <section>
        <SectionTitle>Add a task</SectionTitle>
        <Card className="p-3 sm:p-4">
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor="todo-title" className="sr-only">
              What needs doing
            </label>
            <input
              id="todo-title"
              ref={titleRef}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What needs doing?"
              maxLength={140}
              className={inputClass}
            />

            <div>
              <p className="text-faint mb-1.5 text-xs font-semibold">Who it&rsquo;s for</p>
              <AssigneePicker
                value={draft.assigneeIds}
                onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
              />
            </div>

            <div>
              <p className="text-faint mb-1.5 text-xs font-semibold">How long it takes</p>
              <EstimateField
                value={draft.estimate}
                onChange={(estimate) => setDraft({ ...draft, estimate })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <span className="min-w-0 flex-1">
                <label htmlFor="todo-due" className="text-faint mb-1.5 block text-xs font-semibold">
                  Done by
                </label>
                <input
                  id="todo-due"
                  type="date"
                  value={draft.dueOn}
                  onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })}
                  className={`${inputClass} min-w-0`}
                />
              </span>

              <Button type="submit" disabled={saving || !draft.title.trim()}>
                {saving ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section>
        <SectionTitle
          action={
            totalEstimate ? (
              <span className="text-muted text-xs tabular-nums">
                about {totalEstimate} of work
              </span>
            ) : undefined
          }
        >
          {open.length ? `To do · ${open.length}` : "To do"}
        </SectionTitle>
        <Card>
          {loading ? (
            <div className="space-y-2 p-3" aria-label="Loading the board" role="status">
              <span className="skeleton block h-9 w-full rounded-xl" />
              <span className="skeleton block h-9 w-4/5 rounded-xl" />
            </div>
          ) : open.length === 0 && done.length > 0 ? (
            <div className="tick-cleared flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="bg-accent grid h-14 w-14 place-items-center rounded-full" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-7 w-7" style={{ fill: "none" }}>
                  <path
                    d="M5 12.5 10 17.5 19 7"
                    style={{
                      stroke: "var(--color-on-ink)",
                      strokeWidth: 3,
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                    }}
                  />
                </svg>
              </span>
              <p className="text-base font-semibold">Nothing left to do</p>
              <p className="text-muted text-xs">
                {done.length} {done.length === 1 ? "task" : "tasks"} finished. Enjoy it.
              </p>
            </div>
          ) : open.length === 0 ? (
            <EmptyState
              icon="✅"
              title="No tasks yet"
              hint="Add one above and it shows up on everyone's phone."
            />
          ) : (
            <ul className="p-2">
              {open.map((t) => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  done={false}
                  onToggle={() => void setDone(t.id, true, meId)}
                  onEdit={() => setEditing(t)}
                  onRemove={() => void removeTodo(t.id)}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      {done.length > 0 ? (
        <section>
          <SectionTitle
            action={
              <Button variant="ghost" onClick={() => void clearDone()} className="text-xs">
                Clear
              </Button>
            }
          >
            Done · {done.length}
          </SectionTitle>
          <Card>
            <ul className="p-2">
              {done.map((t) => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  done
                  onToggle={() => void setDone(t.id, false, null)}
                  onEdit={() => setEditing(t)}
                  onRemove={() => void removeTodo(t.id)}
                />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <EditSheet
        todo={editing}
        onClose={() => setEditing(null)}
        onSave={(id, next) =>
          editTodo(id, {
            title: next.title,
            assignee_ids: next.assigneeIds,
            due_on: next.dueOn || null,
            estimate_minutes: estimateMinutes(next.estimate),
          })
        }
      />
    </div>
  );
}
