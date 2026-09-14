"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWeather, type Weather } from "@/lib/weather";
import type { Units, WeatherPlace } from "@/lib/prefs";

/**
 * How often the forecast is re-read.
 *
 * This dashboard lives on a kitchen tablet that is never reloaded, so a
 * one-shot fetch would have it showing yesterday afternoon's weather at
 * breakfast. Fifteen minutes is far finer than the forecast actually changes
 * and is still four requests an hour against a free service.
 */
const REFRESH_MS = 15 * 60 * 1000;

const CACHE_KEY = "family-dashboard:weather";

/**
 * A cached forecast is shown immediately while a fresh one is fetched, so the
 * panel is never a spinner on a tablet that was showing it a minute ago.
 * Anything older than this is stale enough to be misleading and is ignored.
 */
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

function readCache(place: WeatherPlace, units: Units): Weather | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Weather;
    // Cached under different settings is cached for a different question.
    if (cached.units !== units) return null;
    if (cached.place?.lat !== place.lat || cached.place?.lon !== place.lon) return null;
    if (Date.now() - cached.fetchedAt > CACHE_MAX_AGE_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * The weather for one place.
 *
 * Failure is a first-class state rather than an exception: this panel sits on
 * the landing page, the house tablet's network is the house's wifi, and a
 * dashboard that blanks because a forecast service is down would be a worse
 * bug than no weather at all.
 */
export function useWeather(place: WeatherPlace, units: Units, enabled = true) {
  const key = `${place.lat},${place.lon},${units}`;

  const [weather, setWeather] = useState<Weather | null>(() =>
    enabled ? readCache(place, units) : null,
  );
  const [loading, setLoading] = useState(() => enabled && !readCache(place, units));
  const [error, setError] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState(key);

  // Only the newest request may write. Changing the units twice quickly would
  // otherwise leave whichever response happened to land last on screen.
  const generation = useRef(0);

  // A different place or unit is a different question. Re-seeded during render
  // rather than in an effect — this is state derived from a prop changing, and
  // an effect would paint the previous city's numbers under the new label for
  // a frame first.
  if (key !== shownKey) {
    setShownKey(key);
    const cached = readCache(place, units);
    setWeather(cached);
    setLoading(!cached);
    setError(null);
  }

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const mine = ++generation.current;
      try {
        const next = await fetchWeather(place, units, signal);
        if (mine !== generation.current) return;
        setWeather(next);
        setError(null);
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {
          // Private mode. The panel still works; it just re-fetches on reload.
        }
      } catch (e) {
        if (signal?.aborted || mine !== generation.current) return;
        setError(e instanceof Error ? e.message : "Could not reach the weather service.");
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [place, units],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // Kicked off as its own task, matching the load pattern the Supabase hooks
    // use: the effect subscribes to a clock and to one in-flight request, and
    // neither writes state until an answer actually arrives.
    (async () => {
      await load(controller.signal);
    })();
    const id = setInterval(() => void load(controller.signal), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [enabled, load]);

  return { weather, loading, error, reload: () => void load() };
}
