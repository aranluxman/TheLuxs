"use client";

import { useEffect, useState } from "react";
import { useChores } from "@/hooks/useChores";
import { useDailyExtras } from "@/hooks/useDailyExtras";
import { usePrefs } from "@/hooks/usePrefs";
import { useTodos } from "@/hooks/useTodos";
import { addDays, dayKey, format, formatTime, todayKey } from "@/lib/dates";
import { todoVisibleTo, type AgendaItem } from "@/lib/types";
import { useFamily } from "./FamilyProvider";
import { CountUp } from "./motion/CountUp";
import { Marquee } from "./motion/Marquee";
import { Reveal } from "./motion/Reveal";
import { Card } from "./ui";

/**
 * The strip at the top of the Calendar tab: the day, who is holding the phone,
 * what is left to do, and what is coming next.
 *
 * It used to carry two more panels — the next thing on the family calendar, and
 * a note per person about what they were looking forward to. Both are gone at
 * the household's request. The `family_looking_forward` rows are left in the
 * database rather than dropped: nothing reads them now, but deleting three
 * people's notes to remove a panel is not a trade this change gets to make.
 */

/** Which part of the day it is, for the greeting. */
function partOfDay(d = new Date()): "morning" | "afternoon" | "evening" {
  const h = d.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

/**
 * The greeting, re-checked every minute.
 *
 * A minute is plenty: the only thing that can change is which of three words is
 * shown, and it changes twice a day. The alternative — computing it once at
 * mount — leaves the kitchen tablet saying "Good morning" at nine at night,
 * which is precisely the tablet this app was built for.
 */
function useGreeting(): "morning" | "afternoon" | "evening" {
  const [part, setPart] = useState(partOfDay);

  useEffect(() => {
    const id = setInterval(() => {
      const next = partOfDay();
      setPart((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return part;
}

/** One number and its label. The number counts itself in; the label does not. */
function Stat({
  value,
  label,
  live,
}: {
  value: number;
  label: string;
  /** Draws the pulsing dot — only ever for something genuinely new. */
  live?: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      {live ? <span className="live-dot" aria-hidden /> : null}
      <span>
        <CountUp value={value} className="text-ink block text-xl leading-none font-bold" />
        <span className="text-faint mt-0.5 block text-[11px] font-medium">{label}</span>
      </span>
    </span>
  );
}

export function TodayCard({
  agenda,
  unreadCount = 0,
}: {
  /** Everything on the shared calendar, already merged by the tab above. */
  agenda: AgendaItem[];
  /** Messages that have arrived since the chat was last open, on this device. */
  unreadCount?: number;
}) {
  const { prefs } = usePrefs();
  const { currentMember } = useFamily();
  const { quoteOfTheDay } = useDailyExtras(prefs.showQuote);
  const part = useGreeting();

  // Both boards are already live on their own tabs; here they are read for one
  // number each. Only one tab is mounted at a time, so this is one subscription
  // apiece rather than a second copy of anything.
  const { progress } = useChores();
  const { todos } = useTodos();

  const today = todayKey();
  const tomorrow = dayKey(addDays(new Date(), 1));

  const eventsToday = agenda.filter((i) => i.day === today);
  const upNext = agenda
    .filter((i) => i.day === today || i.day === tomorrow)
    .slice(0, 8);

  const openTodos = todos.filter(
    (t) => !t.done_at && todoVisibleTo(t, currentMember?.id ?? null),
  ).length;
  const choresLeft = Math.max(0, progress.total - progress.done);

  return (
    <Card className="today-card">
      <div className="relative z-[1] flex items-end justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
        <div>
          <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Today</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {format(new Date(), "EEEE, MMMM d")}
          </h2>
          {/* Keyed on the part of the day, so noon and six o'clock re-run the
              fade rather than swapping the word underneath the reader. */}
          <p key={part} className="greeting-swap text-muted mt-1 text-sm">
            Good {part}
            {currentMember ? `, ${currentMember.name}` : ""}.
          </p>
        </div>
        <span className="bg-surface/70 text-muted hidden rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm sm:inline-flex">
          Your family at a glance
        </span>
      </div>

      {/* --------------------------------------------------------- the counts */}
      <div
        className="border-line relative z-[1] flex flex-wrap items-center gap-x-7 gap-y-3 border-t px-5 py-3.5 sm:px-6"
        // Counts change under people as things sync. Announced politely so a
        // screen reader mentions it at a pause rather than interrupting.
        aria-live="polite"
      >
        <Stat value={eventsToday.length} label={eventsToday.length === 1 ? "event today" : "events today"} />
        <Stat value={choresLeft} label={choresLeft === 1 ? "chore left" : "chores left"} />
        <Stat value={openTodos} label={openTodos === 1 ? "task to do" : "tasks to do"} />
        {unreadCount > 0 ? (
          <Stat value={unreadCount} label="unread messages" live />
        ) : null}
      </div>

      {/* --------------------------------------------------------- up next */}
      {upNext.length > 0 ? (
        <Reveal className="border-line relative z-[1] border-t">
          <div className="flex items-center gap-2 px-5 py-2.5 sm:px-6">
            <span className="text-faint shrink-0 text-[10px] font-bold tracking-[0.14em] uppercase">
              Up next
            </span>
            <Marquee
              className="min-w-0 flex-1 text-xs"
              label="What is on today and tomorrow"
              // Longer lists take proportionally longer, so the reading speed
              // is the same whether there are two events or eight.
              duration={Math.max(24, upNext.length * 7)}
              items={upNext.map((i) => (
                <span key={i.id} className="text-muted">
                  <span className="text-ink font-semibold tabular-nums">
                    {i.start ? formatTime(i.start) : "All day"}
                  </span>
                  <span className="text-faint"> · </span>
                  {i.title}
                  {i.day === tomorrow ? <span className="text-faint"> (tomorrow)</span> : null}
                </span>
              ))}
            />
          </div>
        </Reveal>
      ) : null}

      {prefs.showQuote && quoteOfTheDay ? (
        <div className="border-line relative z-[1] border-t px-5 py-4 pb-5 sm:px-6">
          <p className="text-ink text-[15px] leading-relaxed font-medium text-balance">
            &ldquo;{quoteOfTheDay.quote_text}&rdquo;
          </p>
          {quoteOfTheDay.author ? (
            <p className="text-faint mt-1.5 text-xs">- {quoteOfTheDay.author}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
