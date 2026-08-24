"use client";

import { useMemo, useState } from "react";
import { useChores } from "@/hooks/useChores";
import {
  CADENCES,
  CHORES,
  CHORE_PEOPLE,
  assigneeSentence,
  cadenceMeta,
  type ChoreDefinition,
} from "@/lib/chores";
import { formatTime, parseISO } from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { ChoreTick, MemberWithPhoto } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Card, ErrorNote } from "./ui";

/**
 * The chore board.
 *
 * Laid out by *cadence* rather than by person, because that is the question
 * being asked. Standing at the sink you want "what is outstanding today"; you
 * do not want to tab through five people to find out. The per-person filter is
 * there for the other question — "what am I on the hook for" — and it filters
 * the same cards rather than re-grouping them, so the board never changes
 * shape under you.
 *
 * `useChores` is called once, here, and the tick plus a toggle are handed down
 * as props. Calling it inside `ChoreCard` would read better at the call site
 * and would open six realtime subscriptions and six identical queries.
 */

/** Names on the roster resolved to real profiles, matched case-insensitively. */
type Roster = Map<string, MemberWithPhoto>;

/* ------------------------------------------------------------ person chip */

function PersonChip({ name, member }: { name: string; member: MemberWithPhoto | undefined }) {
  // Somebody on the roster with no profile on the dashboard still belongs on
  // the board — the chore is theirs whether or not they have ever opened this.
  if (!member) {
    return (
      <span
        className="border-line text-muted inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[11px] font-medium"
        title={`${name} does not have a profile on the dashboard yet`}
      >
        {name}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[11px] font-medium"
      style={{ backgroundColor: tint(member.color, 0.16), color: member.color }}
    >
      <Avatar member={member} size="xs" />
      {member.name}
    </span>
  );
}

/* ------------------------------------------------------------- chore card */

function ChoreCard({
  chore,
  tick,
  roster,
  onToggle,
}: {
  chore: ChoreDefinition;
  tick: ChoreTick | null;
  roster: Roster;
  onToggle: (done: boolean) => void;
}) {
  const { byId } = useFamily();

  const done = tick !== null;
  const meta = cadenceMeta(chore.cadence);
  const doneBy = tick?.done_by ? byId[tick.done_by] : null;

  // The left edge takes the assignee's colour when there is exactly one owner.
  // A shared chore has no single colour to claim, so it falls back to the
  // theme accent rather than picking a name arbitrarily.
  const owner =
    chore.assignees.length === 1 ? roster.get(chore.assignees[0].toLowerCase()) : undefined;

  return (
    <Card
      className="chore-card tile-lift flex flex-col gap-3 p-4"
      data-done={done}
      style={owner ? ({ "--chore-hue": owner.color } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className="bg-sunk grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl"
          aria-hidden
        >
          {chore.icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h4
              className={`min-w-0 flex-1 text-[15px] leading-snug font-semibold ${
                done ? "text-muted" : ""
              }`}
            >
              {chore.title}
            </h4>
            <span className="bg-accent-soft text-accent shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
              {meta.badge}
            </span>
          </div>
          <p className="text-muted mt-0.5 text-xs">{chore.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chore.assignees.map((name) => (
          <PersonChip key={name} name={name} member={roster.get(name.toLowerCase())} />
        ))}
        {chore.rotational ? (
          <span className="text-faint text-[11px]">· any one of them</span>
        ) : null}
      </div>

      {/* The whole strip is the control, not a 20px box. This gets tapped in
          passing, one-handed, often with wet hands. */}
      <button
        onClick={() => onToggle(!done)}
        aria-pressed={done}
        className={`mt-auto flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
          done ? "border-success/40 text-success" : "border-line hover:bg-sunk text-ink"
        }`}
      >
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] ${
            done ? "border-success bg-success text-on-ink" : "border-line"
          }`}
          aria-hidden
        >
          {done ? "✓" : ""}
        </span>
        {done ? (
          <span className="min-w-0 flex-1 truncate font-medium">
            Done
            {doneBy ? ` by ${doneBy.name}` : ""}
            {tick ? ` · ${formatTime(parseISO(tick.done_at))}` : ""}
          </span>
        ) : (
          <span className="flex-1">Mark done</span>
        )}
      </button>
    </Card>
  );
}

/* --------------------------------------------------------------------- tab */

export function ChoresTab() {
  const { members, currentMember } = useFamily();
  const { tickFor, setDone, progress, loading, error } = useChores();
  const [person, setPerson] = useState<string | null>(null);

  const roster: Roster = useMemo(() => {
    const byName = new Map<string, MemberWithPhoto>();
    for (const m of members) byName.set(m.name.trim().toLowerCase(), m);
    return byName;
  }, [members]);

  const visible = useMemo(
    () =>
      person
        ? CHORES.filter((c) =>
            c.assignees.some((a) => a.toLowerCase() === person.toLowerCase()),
          )
        : CHORES,
    [person],
  );

  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <div className="rule-accent">
        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">
          House rota
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Chore board</h2>
        <p className="text-muted mt-0.5 text-sm">
          Who has what, and what is still outstanding. Daily jobs reset at midnight;
          weekly ones reset on Monday morning.
        </p>
      </div>

      {/* --------------------------------------------------------- progress */}
      <Card className="glass-panel p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">
            {progress.done} of {progress.total} done
            <span className="text-muted font-normal"> right now</span>
          </p>
          <p className="text-accent text-sm font-bold tabular-nums">{pct}%</p>
        </div>
        <div
          className="bg-sunk mt-2.5 h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={progress.done}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-label="Chores completed"
        >
          <div
            className="bg-accent h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      {/* ----------------------------------------------------------- filter */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Whose chores">
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
          <span className="text-[11px] tabular-nums opacity-70">{CHORES.length}</span>
        </button>

        {CHORE_PEOPLE.map((name) => {
          const member = roster.get(name.toLowerCase());
          const active = person === name;
          const count = CHORES.filter((c) => c.assignees.includes(name)).length;
          return (
            <button
              key={name}
              role="tab"
              aria-selected={active}
              onClick={() => setPerson(active ? null : name)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "text-ink border-ink"
                  : "border-line bg-surface text-muted hover:bg-sunk"
              }`}
              style={
                active && member
                  ? { borderColor: member.color, backgroundColor: tint(member.color, 0.14) }
                  : undefined
              }
            >
              {member ? <Avatar member={member} size="sm" ring={active} /> : null}
              {name}
              <span className="text-[11px] tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ board */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Loading the board">
          <span className="skeleton block h-40 rounded-xl" />
          <span className="skeleton block h-40 rounded-xl" />
        </div>
      ) : (
        CADENCES.map((cadence) => {
          const group = visible.filter((c) => c.cadence === cadence.id);
          if (group.length === 0) return null;
          return (
            <section key={cadence.id}>
              <div className="mb-3">
                <h3 className="text-muted text-[11px] font-bold tracking-[0.12em] uppercase">
                  {cadence.label}
                </h3>
                <p className="text-faint mt-0.5 text-xs">{cadence.blurb}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.map((chore) => (
                  <ChoreCard
                    key={chore.key}
                    chore={chore}
                    tick={tickFor(chore)}
                    roster={roster}
                    onToggle={(done) => void setDone(chore, done, currentMember?.id ?? null)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {/* The roster in one line, for anyone who wants the whole arrangement
          without reading six cards — and for a screen reader, where the cards
          are a long way apart. */}
      <p className="text-faint border-line border-t pt-4 text-center text-xs">
        {CHORES.map((c) => `${c.title}: ${assigneeSentence(c)}`).join(" · ")}
      </p>
    </div>
  );
}
