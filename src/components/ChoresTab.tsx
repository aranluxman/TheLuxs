"use client";

import { useMemo, useState } from "react";
import { useChores } from "@/hooks/useChores";
import {
  addDays,
  dayKey,
  formatDayLabel,
  parseDayKey,
  startOfWeekMon,
  todayKey,
} from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { Chore, FamilyMember } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Card, EmptyState, ErrorNote, SectionTitle } from "./ui";

function ChoreRow({
  chore,
  member,
  onToggle,
  dimmed = false,
}: {
  chore: Chore;
  member: FamilyMember | null;
  onToggle: (done: boolean) => void;
  dimmed?: boolean;
}) {
  return (
    <li className="border-line flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <input
        type="checkbox"
        checked={chore.is_completed}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-5 w-5 shrink-0 cursor-pointer rounded-md accent-current"
        style={{ color: member?.color ?? "#78716c" }}
        aria-label={`Mark "${chore.title}" ${chore.is_completed ? "not done" : "done"}`}
      />

      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${
            chore.is_completed ? "text-faint line-through" : ""
          } ${dimmed && !chore.is_completed ? "text-muted" : ""}`}
        >
          {chore.title}
        </p>
        {chore.description ? (
          <p className="text-faint truncate text-xs">{chore.description}</p>
        ) : null}
      </div>

      <span
        className="hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline"
        style={{
          backgroundColor: tint(member?.color ?? "#78716c", 0.14),
          color: member?.color ?? "#78716c",
        }}
      >
        {member?.name ?? "Unassigned"}
      </span>
      <span className="sm:hidden">
        <Avatar member={member} size="sm" />
      </span>
    </li>
  );
}

export function ChoresTab() {
  const { currentMember, byId } = useFamily();
  const [scope, setScope] = useState<"mine" | "everyone">("mine");

  const today = new Date();
  const from = dayKey(addDays(today, -1));
  const to = dayKey(addDays(today, 21));

  const { chores, loading, error, toggleChore } = useChores(from, to);

  const todayK = todayKey();
  const weekEndK = dayKey(addDays(startOfWeekMon(today), 6));

  const visible = useMemo(
    () =>
      scope === "mine" && currentMember
        ? chores.filter((c) => c.assigned_member_id === currentMember.id)
        : chores,
    [chores, scope, currentMember],
  );

  const todayChores = visible.filter(
    (c) => c.recurrence_type === "daily" && c.due_date === todayK,
  );
  const weekChores = visible.filter(
    (c) => c.recurrence_type === "weekly" && c.due_date === weekEndK,
  );

  // The next week of daily assignments, so everyone can see the rotation coming.
  const upcoming = useMemo(() => {
    const days: { key: string; items: Chore[] }[] = [];
    for (let i = 1; i <= 6; i++) {
      const key = dayKey(addDays(today, i));
      const items = visible.filter(
        (c) => c.recurrence_type === "daily" && c.due_date === key,
      );
      if (items.length) days.push({ key, items });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const doneToday = todayChores.filter((c) => c.is_completed).length;

  const toggle = (chore: Chore, done: boolean) =>
    toggleChore(chore, done, currentMember?.id ?? null);

  return (
    <div className="space-y-8">
      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{formatDayLabel(today)}</h2>
          <p className="text-muted mt-0.5 text-sm">
            {todayChores.length === 0
              ? "Nothing due today."
              : `${doneToday} of ${todayChores.length} done`}
          </p>
        </div>

        <div className="bg-sunk inline-flex rounded-xl p-1">
          {(["mine", "everyone"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              disabled={s === "mine" && !currentMember}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                scope === s ? "bg-surface text-ink shadow-sm" : "text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {todayChores.length > 0 ? (
        <div
          className="bg-sunk h-1.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={doneToday}
          aria-valuemin={0}
          aria-valuemax={todayChores.length}
          aria-label="Chores completed today"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${(doneToday / todayChores.length) * 100}%`,
              backgroundColor: currentMember?.color ?? "#1c1917",
            }}
          />
        </div>
      ) : null}

      <section>
        <SectionTitle>Daily · today</SectionTitle>
        <Card>
          {loading ? (
            <p className="text-muted px-4 py-6 text-sm">Loading…</p>
          ) : todayChores.length === 0 ? (
            <EmptyState
              icon="✨"
              title={scope === "mine" ? "You're off the hook today" : "No daily chores today"}
              hint={
                scope === "mine"
                  ? "Switch to Everyone to see what the rest of the house is doing."
                  : undefined
              }
            />
          ) : (
            <ul>
              {todayChores.map((c) => (
                <ChoreRow
                  key={c.id}
                  chore={c}
                  member={c.assigned_member_id ? (byId[c.assigned_member_id] ?? null) : null}
                  onToggle={(done) => toggle(c, done)}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Deep clean · this week</SectionTitle>
        <Card>
          {weekChores.length === 0 ? (
            <EmptyState icon="🧹" title="Nothing heavy this week" />
          ) : (
            <ul>
              {weekChores.map((c) => (
                <ChoreRow
                  key={c.id}
                  chore={c}
                  member={c.assigned_member_id ? (byId[c.assigned_member_id] ?? null) : null}
                  onToggle={(done) => toggle(c, done)}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      {upcoming.length > 0 ? (
        <section>
          <SectionTitle>Coming up</SectionTitle>
          <div className="space-y-3">
            {upcoming.map(({ key, items }) => (
              <Card key={key} className="px-4 py-3">
                <p className="text-muted mb-2 text-xs font-semibold">
                  {formatDayLabel(parseDayKey(key))}
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {items.map((c) => {
                    const m = c.assigned_member_id ? (byId[c.assigned_member_id] ?? null) : null;
                    return (
                      <li key={c.id} className="flex items-center gap-1.5 text-sm">
                        <span aria-hidden>{m?.avatar_emoji ?? "·"}</span>
                        <span className="text-muted">{c.title}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
