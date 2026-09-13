"use client";

import { useMemo, useRef, useState } from "react";
import { useTodos } from "@/hooks/useTodos";
import { addDays, dayKey, format, parseDayKey, todayKey } from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { Todo } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNote,
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

/* --------------------------------------------------------------------- Row */

function TodoRow({
  todo,
  done,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  done: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { byId } = useFamily();
  const assignee = todo.assigned_to ? byId[todo.assigned_to] : null;
  const due = todo.due_on ? dueLabel(todo.due_on) : null;

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
          <span className="mt-0.5 flex items-center gap-1.5 text-xs">
            {assignee ? (
              <span
                className="rounded px-1 font-medium"
                style={{ backgroundColor: tint(assignee.color, 0.16), color: assignee.color }}
              >
                {assignee.name}
              </span>
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
          </span>
        </span>
      </label>

      {assignee ? (
        <span className="hidden shrink-0 opacity-70 sm:block">
          <Avatar member={assignee} size="sm" decorative />
        </span>
      ) : null}

      {/* Always visible rather than revealed on hover: there is no hover on a
          phone, and this list is used almost entirely on phones. */}
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
  const { members, currentMember } = useFamily();
  const { todos, loading, error, addTodo, setDone, removeTodo, clearDone } = useTodos();

  const [title, setTitle] = useState("");
  /** "" is the Everyone option — a select cannot hold null. */
  const [assignee, setAssignee] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const { open, done } = useMemo(() => {
    const o: Todo[] = [];
    const d: Todo[] = [];
    for (const t of todos) (t.done_at ? d : o).push(t);
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
    return { open: o, done: d };
  }, [todos]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const ok = await addTodo(title, assignee || null, dueOn || null, currentMember?.id ?? null);
    setSaving(false);
    if (ok) {
      setTitle("");
      setDueOn("");
      // The assignee is left as it was: adding three jobs for the same person
      // is the common case, and re-picking them each time is friction.
      titleRef.current?.focus();
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <section>
        <SectionTitle>Add a task</SectionTitle>
        <Card className="p-3 sm:p-4">
          <form onSubmit={submit} className="space-y-2">
            <label htmlFor="todo-title" className="sr-only">
              What needs doing
            </label>
            <input
              id="todo-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              maxLength={140}
              className={inputClass}
            />

            <div className="flex flex-wrap gap-2">
              <label htmlFor="todo-who" className="sr-only">
                Who it is for
              </label>
              <select
                id="todo-who"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={`${inputClass} min-w-0 flex-1`}
              >
                <option value="">Everyone</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <label htmlFor="todo-due" className="sr-only">
                Due date
              </label>
              <input
                id="todo-due"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className={`${inputClass} min-w-0 flex-1`}
              />

              <Button type="submit" disabled={saving || !title.trim()}>
                {saving ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section>
        <SectionTitle>
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
                  onToggle={() => void setDone(t.id, true, currentMember?.id ?? null)}
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
                  onRemove={() => void removeTodo(t.id)}
                />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
