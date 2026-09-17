"use client";

import { useMemo, useState } from "react";
import { useChores } from "@/hooks/useChores";
import {
  HISTORY_RANGES,
  useChoreHistory,
  type HistoryRangeId,
} from "@/hooks/useChoreHistory";
import {
  CADENCES,
  CHORES,
  POINTS_AVAILABLE_PER_WEEK,
  cadenceMeta,
  chorePoints,
  type ChoreDefinition,
} from "@/lib/chores";
import {
  addDays,
  format,
  formatDayLabel,
  formatTime,
  parseISO,
  startOfWeekMon,
} from "@/lib/dates";
import { tint } from "@/lib/palette";
import type { ChoreTick, MemberWithPhoto } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { Confetti } from "./motion/Confetti";
import { CountUp } from "./motion/CountUp";
import { Reveal } from "./motion/Reveal";
import { useInView } from "@/hooks/useInView";
import { Avatar, Button, Card, EmptyState, ErrorNote } from "./ui";

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
  // The bars are the whole point of the panel, so they grow when somebody is
  // actually looking at them rather than while the tab is still painting.
  const { ref, inView } = useInView<HTMLOListElement>({ amount: 0.3 });
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
          <CountUp value={total} className="text-accent font-bold" /> of{" "}
          {POINTS_AVAILABLE_PER_WEEK} points claimed
        </p>
      </div>

      <ol ref={ref} className="divide-line divide-y">
        {standings.map((s, i) => (
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
              {/* The crown drops in once, on whoever is actually ahead. */}
              {s.leader ? <span className="crown-in">👑</span> : s.rank}
            </span>

            <Avatar member={s.member} size="sm" ring={s.leader} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.member.name}</span>
              {/* A bar against the leader's score, not against the weekly
                  maximum: the question on a scoreboard is "how far behind am
                  I", and against 31 every real score is a sliver. */}
              {/* Scaled rather than widened: `width` is a layout property and
                  five of them animating at once is five reflows a frame, where
                  a transform is handed straight to the compositor. */}
              <span className="bg-sunk mt-1 block h-1.5 overflow-hidden rounded-full">
                <span
                  className="meter-fill block h-full w-full rounded-full"
                  data-grown={inView ? "true" : undefined}
                  style={{
                    "--meter": top > 0 ? s.points / top : 0,
                    backgroundColor: s.member.color,
                    transitionDelay: `${i * 100}ms`,
                  } as React.CSSProperties}
                />
              </span>
            </span>

            <span className="shrink-0 text-right">
              <CountUp value={s.points} className="block text-sm font-bold" />
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
            the most points this week.
          </>
        ) : (
          <>
            <strong className="text-ink font-semibold">
              {leaders.map((l) => l.member.name).join(" and ")}
            </strong>{" "}
            are tied for the most points this week.
          </>
        )}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------- chore card */

function ChoreCard({
  chore,
  ticks,
  onToggleMember,
}: {
  chore: ChoreDefinition;
  ticks: ChoreTick[];
  onToggleMember: (memberId: string) => void;
}) {
  const { members, byId } = useFamily();

  const done = ticks.length > 0;
  const meta = cadenceMeta(chore.cadence);
  const points = chorePoints(chore);
  const signedUp = new Set(ticks.map((t) => t.done_by).filter(Boolean) as string[]);

  return (
    <Card
      className="chore-card tile-lift flex h-full flex-col gap-3 p-4"
      data-done={done}
      style={
        ticks[0]?.done_by && byId[ticks[0].done_by]
          ? ({ "--chore-hue": byId[ticks[0].done_by].color } as React.CSSProperties)
          : undefined
      }
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
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="bg-accent-soft text-accent rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                {meta.badge}
              </span>
              {/* Worth saying on the card rather than only in the rules: the
                  whole reason to mop instead of wiping the table is that it
                  pays double, and a scoreboard that hides its own odds is not
                  a scoreboard. */}
              <span className="border-line text-muted rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums">
                {points} {points === 1 ? "pt" : "pts"}
              </span>
            </span>
          </div>
          <p className="text-muted mt-0.5 text-xs">{chore.detail}</p>
          {chore.multi ? (
            <p className="text-faint mt-1 text-[11px]">
              Done more than once a day — everyone who helps takes the points.
            </p>
          ) : null}
        </div>
      </div>

      {/* Everyone's face on every card. Tapping one is the whole interaction:
          it signs you up, or — on a one-owner chore — hands it to whoever
          actually did it if the first tap was wrong. Tapping your own face
          again takes your name back off. */}
      <div className="mt-auto">
        <p className="text-faint mb-2 text-[11px] font-semibold">
          {done
            ? chore.multi
              ? `Points to ${signedUp.size} ${signedUp.size === 1 ? "person" : "people"}`
              : "Point goes to"
            : "Who did it?"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const mine = signedUp.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => onToggleMember(m.id)}
                aria-pressed={mine}
                title={
                  mine
                    ? `${m.name} did this — tap again to undo`
                    : `${m.name} did this`
                }
                aria-label={
                  mine
                    ? `${m.name} did ${chore.title}. Tap again to undo.`
                    : `Give the points for ${chore.title} to ${m.name}`
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
        <div className="border-success/30 space-y-1 border-t pt-2.5">
          {ticks.map((t) => {
            const who = t.done_by ? byId[t.done_by] : null;
            return (
              <p
                key={t.id}
                className="text-success flex items-center gap-1.5 text-xs font-medium"
              >
                <span aria-hidden>✓</span>
                {who ? `${who.name} · ` : ""}
                {formatTime(parseISO(t.done_at))}
                <span className="text-faint ml-auto font-normal">
                  +{t.points ?? 1} {(t.points ?? 1) === 1 ? "point" : "points"}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

/* ----------------------------------------------------------------- history */

/**
 * Everything the house has ticked off, and who has done the most of it.
 *
 * Collapsed behind a button rather than open by default: the board is what you
 * come here for, and the history is what you come here for once a month when
 * somebody claims they always do the dishes.
 */
function History() {
  const { byId, members } = useFamily();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<HistoryRangeId>("30d");
  const { entries, totals, loading, error } = useChoreHistory(range, open);

  const topChores = totals[0]?.chores ?? 0;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-muted text-[11px] font-bold tracking-[0.12em] uppercase">
            History
          </h3>
          <p className="text-faint mt-0.5 text-xs">
            Everything that has been ticked off, and who has done the most.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show history"}
        </Button>
      </div>

      {/* Opened and closed in place: `grid-template-rows` is the one way to
          animate "to the height of my content" without measuring it. */}
      <div className="collapsible" data-open={open ? "true" : "false"}>
        <div>
        <div className="space-y-3">
          <ErrorNote message={error} />

          <div className="bg-sunk inline-flex rounded-xl p-1 shadow-inner" role="group" aria-label="How far back">
            {HISTORY_RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  range === r.id ? "bg-surface text-ink shadow-sm" : "text-muted"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2" role="status" aria-label="Loading the history">
              <span className="skeleton block h-32 rounded-xl" />
              <span className="skeleton block h-40 rounded-xl" />
            </div>
          ) : entries.length === 0 ? (
            <Card>
              <EmptyState
                icon="📜"
                title="Nothing in the history yet"
                hint="Tick a chore off and it lands here for good."
              />
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <p className="border-line text-muted border-b px-4 py-2.5 text-xs font-semibold">
                  Who did the most
                </p>
                <ol className="divide-line divide-y">
                  {totals.map((row, i) => {
                    const member = byId[row.memberId];
                    if (!member) return null;
                    return (
                      <li key={row.memberId} className="flex items-center gap-3 px-4 py-2.5">
                        <span
                          className={`w-5 shrink-0 text-center text-xs font-bold tabular-nums ${
                            i === 0 ? "text-accent" : "text-faint"
                          }`}
                        >
                          {i === 0 ? <span className="crown-in">🥇</span> : i + 1}
                        </span>
                        <Avatar member={member} size="sm" ring={i === 0} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {member.name}
                          </span>
                          <span className="bg-sunk mt-1 block h-1.5 overflow-hidden rounded-full">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: topChores > 0 ? `${(row.chores / topChores) * 100}%` : "0%",
                                backgroundColor: member.color,
                              }}
                            />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <CountUp value={row.chores} className="block text-sm font-bold" />
                          <span className="text-faint block text-[10px] tabular-nums">
                            {row.points} {row.points === 1 ? "point" : "points"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                  {/* Somebody who has not done a chore in the window still
                      belongs on the table — a missing row reads as a loading
                      bug, a zero reads as a fact. */}
                  {members
                    .filter((m) => !totals.some((t) => t.memberId === m.id))
                    .map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                        <span className="text-faint w-5 shrink-0 text-center text-xs font-bold">
                          –
                        </span>
                        <Avatar member={m} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {m.name}
                        </span>
                        <span className="text-faint shrink-0 text-xs tabular-nums">0</span>
                      </li>
                    ))}
                </ol>
              </Card>

              <Card className="overflow-hidden">
                <p className="border-line text-muted border-b px-4 py-2.5 text-xs font-semibold">
                  Recently done
                </p>
                <ul className="divide-line max-h-96 divide-y overflow-y-auto">
                  {entries.map((e) => {
                    const who = e.tick.done_by ? byId[e.tick.done_by] : null;
                    const at = parseISO(e.tick.done_at);
                    return (
                      <li key={e.tick.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="bg-sunk grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base" aria-hidden>
                          {e.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{e.title}</span>
                          <span className="text-faint block text-xs">
                            {who ? `${who.name} · ` : ""}
                            {formatDayLabel(at)} · {formatTime(at)}
                          </span>
                        </span>
                        <span className="text-muted shrink-0 text-xs font-semibold tabular-nums">
                          +{e.tick.points ?? 1}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- tab */

export function ChoresTab() {
  const { members } = useFamily();
  const { ticksFor, toggleMember, scores, progress, loading, error } = useChores();

  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  /*
   * The board being finished is worth marking — once.
   *
   * Keyed on the transition into "everything done" rather than on the state
   * itself: without that, every re-render while the board sits complete would
   * throw another handful of paper, and coming back to the tab tomorrow would
   * celebrate yesterday's work again.
   */
  const cleared = progress.total > 0 && progress.done === progress.total;
  const [seenCleared, setSeenCleared] = useState<boolean | null>(null);
  const [burst, setBurst] = useState(0);
  if (!loading && seenCleared !== cleared) {
    // The first state seen after the data lands is the baseline, never a
    // celebration: opening a screen that was already finished is not an
    // achievement, and the burst would then fire on every visit.
    const firstLook = seenCleared === null;
    setSeenCleared(cleared);
    if (cleared && !firstLook) setBurst((n) => n + 1);
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <div className="rule-accent">
        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">
          House rota
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Chore board</h2>
        <p className="text-muted mt-0.5 text-sm">
          Nothing is assigned. Do a chore, tap your name, take the points — most points
          by Sunday night wins the week. Some jobs are worth two, and the ones done
          several times a day take as many names as helped.
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
              className="bg-sunk relative h-2 overflow-visible rounded-full"
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
              {/* Thrown from the bar that just filled, in the family's own
                  colours. Twenty pieces, 1.2s, then removed from the DOM. */}
              {burst > 0 ? (
                <Confetti burstKey={burst} colors={members.map((m) => m.color)} />
              ) : null}
            </div>
            {cleared ? (
              <p className="text-success mt-2 text-center text-xs font-semibold" role="status">
                Every chore on the board is done. Nothing left to do.
              </p>
            ) : null}
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
                  {group.map((chore, i) => (
                    <Reveal key={chore.key} when="in-view" delay={i * 60} className="h-full">
                    <ChoreCard
                      chore={chore}
                      ticks={ticksFor(chore)}
                      onToggleMember={(memberId) => void toggleMember(chore, memberId)}
                    />
                    </Reveal>
                  ))}
                </div>
              </section>
            );
          })}

          <History />
        </>
      )}
    </div>
  );
}
