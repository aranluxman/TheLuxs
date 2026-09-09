"use client";

import { useMemo } from "react";
import { useChores } from "@/hooks/useChores";
import {
  CADENCES,
  CHORES,
  POINTS_AVAILABLE_PER_WEEK,
  cadenceMeta,
  type ChoreDefinition,
} from "@/lib/chores";
import { addDays, format, formatTime, parseISO, startOfWeekMon } from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { ChoreTick, MemberWithPhoto } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Avatar, Card, ErrorNote } from "./ui";

/**
 * The chore board.
 *
 * Nothing here is assigned. Every card is open to whoever gets to it, and the
 * tick records who that was — so the leaderboard, not the roster, is what says
 * who does the work in this house.
 *
 * `useChores` is called once, at the top, and each card is handed its tick and
 * a setter. Calling it inside `ChoreCard` would read better at the call site
 * and would open seven realtime subscriptions and seven identical queries.
 */

/* ------------------------------------------------------------ leaderboard */

interface Standing {
  member: MemberWithPhoto;
  points: number;
  /** 1-based, and shared by everyone on the same score. */
  rank: number;
  leader: boolean;
}

function useStandings(scores: Record<string, number>): Standing[] {
  const { members } = useFamily();
  return useMemo(() => {
    const rows = members
      .map((member) => ({ member, points: scores[member.id] ?? 0 }))
      // Points first, then the household's own order, so a table of zeroes on
      // Monday morning is stable rather than shuffling on every render.
      .sort((a, b) => b.points - a.points || a.member.sort_order - b.member.sort_order);

    const top = rows[0]?.points ?? 0;
    const out: Standing[] = [];

    for (let i = 0; i < rows.length; i++) {
      // Standard competition ranking: equal scores share a rank, and the next
      // distinct score skips the numbers they used up. Read back off the row
      // already placed rather than from a running variable, so nothing here
      // mutates across a render.
      const above = out[i - 1];
      const rank = above && above.points === rows[i].points ? above.rank : i + 1;
      // Nobody leads on nil. A crown for being first to have done nothing
      // would be the opposite of the point.
      out.push({ ...rows[i], rank, leader: top > 0 && rows[i].points === top });
    }
    return out;
  }, [members, scores]);
}

function Leaderboard({ scores }: { scores: Record<string, number> }) {
  const standings = useStandings(scores);
  const total = standings.reduce((sum, s) => sum + s.points, 0);
  const top = standings[0]?.points ?? 0;
  const leaders = standings.filter((s) => s.leader);

  const weekStart = startOfWeekMon(new Date());
  const weekLabel = `${format(weekStart, "MMM d")} – ${format(addDays(weekStart, 6), "MMM d")}`;

  return (
    <Card className="glass-panel overflow-hidden">
      <div className="border-line flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-bold tracking-tight">This week&rsquo;s leaderboard</h3>
          <p className="text-faint text-[11px]">{weekLabel} · resets Monday</p>
        </div>
        <p className="text-muted text-xs tabular-nums">
          <span className="text-accent font-bold">{total}</span> of{" "}
          {POINTS_AVAILABLE_PER_WEEK} points claimed
        </p>
      </div>

      <ol className="divide-line divide-y">
        {standings.map((s) => (
          <li
            key={s.member.id}
            className="flex items-center gap-3 px-4 py-2.5"
            style={s.leader ? { backgroundColor: tint(s.member.color, 0.08) } : undefined}
          >
            <span
              className={`w-5 shrink-0 text-center text-xs font-bold tabular-nums ${
                s.leader ? "text-accent" : "text-faint"
              }`}
            >
              {s.leader ? "👑" : s.rank}
            </span>

            <Avatar member={s.member} size="sm" ring={s.leader} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.member.name}</span>
              {/* A bar against the leader's score, not against the weekly
                  maximum: the question on a scoreboard is "how far behind am
                  I", and against 31 every real score is a sliver. */}
              <span className="bg-sunk mt-1 block h-1.5 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: top > 0 ? `${(s.points / top) * 100}%` : "0%",
                    backgroundColor: s.member.color,
                  }}
                />
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-sm font-bold tabular-nums">{s.points}</span>
              <span className="text-faint block text-[10px]">
                {s.points === 1 ? "point" : "points"}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <p className="text-muted border-line border-t px-4 py-2.5 text-xs">
        {total === 0 ? (
          <>No points yet this week — first chore done takes the lead.</>
        ) : leaders.length === 1 ? (
          <>
            <strong className="text-ink font-semibold">{leaders[0].member.name}</strong> has
            done the most chores this week.
          </>
        ) : (
          <>
            <strong className="text-ink font-semibold">
              {leaders.map((l) => l.member.name).join(" and ")}
            </strong>{" "}
            are tied for the most chores this week.
          </>
        )}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------- chore card */

function ChoreCard({
  chore,
  tick,
  onSetDoneBy,
}: {
  chore: ChoreDefinition;
  tick: ChoreTick | null;
  onSetDoneBy: (memberId: string | null) => void;
}) {
  const { members, byId } = useFamily();

  const done = tick !== null;
  const meta = cadenceMeta(chore.cadence);
  const doneBy = tick?.done_by ? byId[tick.done_by] : null;

  return (
    <Card
      className="chore-card tile-lift flex flex-col gap-3 p-4"
      data-done={done}
      style={doneBy ? ({ "--chore-hue": doneBy.color } as React.CSSProperties) : undefined}
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
            <h4 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">
              {chore.title}
            </h4>
            <span className="bg-accent-soft text-accent shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
              {meta.badge}
            </span>
          </div>
          <p className="text-muted mt-0.5 text-xs">{chore.detail}</p>
        </div>
      </div>

      {/* Everyone's face on every card. Tapping one is the whole interaction:
          it claims the chore, or hands it to whoever actually did it if the
          first tap was wrong. */}
      <div className="mt-auto">
        <p className="text-faint mb-2 text-[11px] font-semibold">
          {done ? "Point goes to" : "Who did it?"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const mine = tick?.done_by === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSetDoneBy(mine ? null : m.id)}
                aria-pressed={mine}
                title={
                  mine
                    ? `${m.name} did this — tap again to undo`
                    : `${m.name} did this`
                }
                aria-label={
                  mine
                    ? `${m.name} did ${chore.title}. Tap again to undo.`
                    : `Give the point for ${chore.title} to ${m.name}`
                }
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs font-semibold transition-colors ${
                  mine ? "text-ink" : "border-line text-muted hover:bg-sunk"
                }`}
                style={
                  mine
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
      </div>

      {done ? (
        <p className="text-success border-success/30 flex items-center gap-1.5 border-t pt-2.5 text-xs font-medium">
          <span aria-hidden>✓</span>
          {doneBy ? `${doneBy.name} · ` : ""}
          {tick ? formatTime(parseISO(tick.done_at)) : ""}
          <span className="text-faint ml-auto font-normal">+1 point</span>
        </p>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------------- tab */

export function ChoresTab() {
  const { tickFor, setDoneBy, scores, progress, loading, error } = useChores();

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
          Nothing is assigned. Do a chore, tap your name, take the point — most points
          by Sunday night wins the week.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading the board">
          <span className="skeleton block h-56 rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2">
            <span className="skeleton block h-44 rounded-xl" />
            <span className="skeleton block h-44 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          <Leaderboard scores={scores} />

          {/* ------------------------------------------------------ progress */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <p className="text-muted text-[11px] font-bold tracking-[0.12em] uppercase">
                On the board right now
              </p>
              <p className="text-muted text-xs tabular-nums">
                {progress.done} of {progress.total} done · {pct}%
              </p>
            </div>
            <div
              className="bg-sunk h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-label="Chores done right now"
            >
              <div
                className="bg-accent h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* --------------------------------------------------------- board */}
          {CADENCES.map((cadence) => {
            const group = CHORES.filter((c) => c.cadence === cadence.id);
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
                      onSetDoneBy={(memberId) => void setDoneBy(chore, memberId)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
