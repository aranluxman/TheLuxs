"use client";

import { usePrefs } from "@/hooks/usePrefs";
import { useWeather } from "@/hooks/useWeather";
import { format, parseDayKey, todayKey } from "@/lib/dates";
import { UNIT_SUFFIX, describeCode } from "@/lib/weather";
import { Card } from "./ui";

/**
 * The weather, on the landing page.
 *
 * Deliberately one card and not a page: what the house asks the dashboard on
 * the way out of the door is "coat or no coat", which is now, the feel, and
 * whether it is going to rain later. The four-day strip under it is the whole
 * of the rest.
 *
 * Hidden entirely when the device has turned it off in Settings — the panel is
 * the only thing here that talks to a service outside Supabase, and a household
 * that does not want that should be able to say so.
 */
export function WeatherCard() {
  const { prefs } = usePrefs();
  const { weather, loading, error } = useWeather(
    prefs.weatherPlace,
    prefs.units,
    prefs.showWeather,
  );

  if (!prefs.showWeather) return null;

  const suffix = UNIT_SUFFIX[prefs.units];
  const round = (n: number) => Math.round(n);

  if (loading && !weather) {
    return (
      <Card className="p-4" role="status" aria-label="Loading the weather">
        <span className="skeleton block h-16 w-full rounded-xl" />
      </Card>
    );
  }

  // An error with nothing cached is said plainly and small. The alternative —
  // hiding the panel — reads as "the setting did not take".
  if (!weather) {
    return (
      <Card className="p-4">
        <p className="text-muted text-xs">
          <span className="mr-1.5" aria-hidden>
            🌡️
          </span>
          {error ?? "No weather right now."}
        </p>
      </Card>
    );
  }

  const now = describeCode(weather.now.code, weather.now.isDay);
  const today = todayKey();
  const ahead = weather.days.filter((d) => d.day > today).slice(0, 4);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <span className="text-4xl leading-none" aria-hidden>
          {now.icon}
        </span>

        <div className="min-w-0">
          <p className="text-2xl leading-none font-bold tabular-nums">
            {round(weather.now.temperature)}
            {suffix.temp}
          </p>
          <p className="text-muted mt-1 text-xs">
            {now.label} · feels like {round(weather.now.feelsLike)}
            {suffix.temp}
          </p>
        </div>

        <div className="text-faint ml-auto text-right text-xs">
          <p className="font-semibold">{weather.place.label}</p>
          <p className="tabular-nums">
            wind {round(weather.now.wind)} {suffix.wind}
          </p>
        </div>
      </div>

      {ahead.length ? (
        <ul className="border-line grid grid-cols-4 border-t">
          {ahead.map((d) => {
            const glyph = describeCode(d.code);
            return (
              <li
                key={d.day}
                className="border-line flex flex-col items-center gap-0.5 border-l px-2 py-2.5 first:border-l-0"
              >
                <span className="text-faint text-[11px] font-semibold">
                  {format(parseDayKey(d.day), "EEE")}
                </span>
                <span className="text-lg leading-none" aria-hidden>
                  {glyph.icon}
                </span>
                <span className="sr-only">{glyph.label}. </span>
                <span className="text-xs font-semibold tabular-nums">
                  {round(d.high)}°
                  <span className="text-faint font-normal"> {round(d.low)}°</span>
                </span>
                {/* Only when it is worth knowing. A 4% chance on the strip is
                    noise that makes the two numbers beside it harder to read. */}
                {d.rainChance !== null && d.rainChance >= 20 ? (
                  <span className="text-accent text-[10px] font-semibold tabular-nums">
                    💧{d.rainChance}%
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
