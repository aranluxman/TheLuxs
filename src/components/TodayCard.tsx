"use client";

import { useDailyExtras } from "@/hooks/useDailyExtras";
import { format } from "@/lib/dates";
import { Card } from "./ui";

/**
 * The strip at the top of the Calendar tab: today's date and a shared quote.
 *
 * It used to carry two more panels — the next thing on the family calendar, and
 * a note per person about what they were looking forward to. Both are gone at
 * the household's request. The `family_looking_forward` rows are left in the
 * database rather than dropped: nothing reads them now, but deleting three
 * people's notes to remove a panel is not a trade this change gets to make.
 */
export function TodayCard() {
  const { quoteOfTheDay } = useDailyExtras();

  return (
    <Card className="today-card">
      <div className="relative z-[1] flex items-end justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
        <div>
          <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Today</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {format(new Date(), "EEEE, MMMM d")}
          </h2>
        </div>
        <span className="bg-surface/70 text-muted hidden rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm sm:inline-flex">
          Your family at a glance
        </span>
      </div>
      {quoteOfTheDay ? (
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
