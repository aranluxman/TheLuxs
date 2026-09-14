/**
 * The weather, from Open-Meteo.
 *
 * Chosen because it needs no API key. Everything else in this app is either
 * Supabase or the browser, and a weather panel is not worth introducing a
 * secret that would have to ship inside a static site to be usable — which is
 * to say, not be a secret. The forecast endpoint is a plain GET with no auth
 * and generous free limits.
 *
 * https://open-meteo.com/en/docs
 */

import type { Units, WeatherPlace } from "./prefs";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/**
 * WMO weather interpretation codes, as words and a glyph.
 *
 * The full table is ~30 codes; they collapse cleanly into the handful of
 * things a person at a kitchen counter actually wants to know. Anything
 * unlisted falls through to the "unknown" row rather than rendering a number
 * nobody can read.
 */
const CODES: Record<number, { label: string; icon: string; night?: string }> = {
  0: { label: "Clear", icon: "☀️", night: "🌙" },
  1: { label: "Mostly clear", icon: "🌤️", night: "🌙" },
  2: { label: "Partly cloudy", icon: "⛅", night: "☁️" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Freezing fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Heavy drizzle", icon: "🌧️" },
  56: { label: "Freezing drizzle", icon: "🌧️" },
  57: { label: "Freezing drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌦️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "🌧️" },
  66: { label: "Freezing rain", icon: "🌧️" },
  67: { label: "Freezing rain", icon: "🌧️" },
  71: { label: "Light snow", icon: "🌨️" },
  73: { label: "Snow", icon: "❄️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨️" },
  80: { label: "Showers", icon: "🌦️" },
  81: { label: "Showers", icon: "🌧️" },
  82: { label: "Heavy showers", icon: "⛈️" },
  85: { label: "Snow showers", icon: "🌨️" },
  86: { label: "Snow showers", icon: "❄️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Thunderstorm", icon: "⛈️" },
  99: { label: "Thunderstorm", icon: "⛈️" },
};

export function describeCode(code: number, isDay = true): { label: string; icon: string } {
  const row = CODES[code];
  if (!row) return { label: "—", icon: "🌡️" };
  return { label: row.label, icon: !isDay && row.night ? row.night : row.icon };
}

export interface WeatherNow {
  temperature: number;
  feelsLike: number;
  code: number;
  isDay: boolean;
  wind: number;
}

export interface WeatherDay {
  /** Local `YYYY-MM-DD`, straight from the API's `timezone=auto` response. */
  day: string;
  code: number;
  high: number;
  low: number;
  /** Percent, or null when the forecast does not carry one. */
  rainChance: number | null;
}

export interface Weather {
  now: WeatherNow;
  days: WeatherDay[];
  /** What the numbers are in — so a cached panel cannot mislabel itself. */
  units: Units;
  place: WeatherPlace;
  fetchedAt: number;
}

/** Degree and speed suffixes, as they are printed. */
export const UNIT_SUFFIX: Record<Units, { temp: string; wind: string }> = {
  metric: { temp: "°C", wind: "km/h" },
  imperial: { temp: "°F", wind: "mph" },
};

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    is_day?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

/**
 * One forecast. Throws on anything that is not a usable answer, so the caller
 * has exactly one failure path to render.
 *
 * `timezone=auto` matters: without it the daily rows are bucketed in UTC, and
 * "tomorrow" on a Toronto evening would be the wrong day.
 */
export async function fetchWeather(
  place: WeatherPlace,
  units: Units,
  signal?: AbortSignal,
): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "5",
    temperature_unit: units === "imperial" ? "fahrenheit" : "celsius",
    wind_speed_unit: units === "imperial" ? "mph" : "kmh",
  });

  const res = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!res.ok) throw new Error(`Weather service said ${res.status}.`);

  const json = (await res.json()) as OpenMeteoResponse;
  const current = json.current;
  if (!current || typeof current.temperature_2m !== "number") {
    throw new Error("The weather service sent something unexpected.");
  }

  const daily = json.daily;
  const days: WeatherDay[] = (daily?.time ?? []).map((day, i) => ({
    day,
    code: daily?.weather_code?.[i] ?? 0,
    high: daily?.temperature_2m_max?.[i] ?? 0,
    low: daily?.temperature_2m_min?.[i] ?? 0,
    rainChance: daily?.precipitation_probability_max?.[i] ?? null,
  }));

  return {
    now: {
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature ?? current.temperature_2m,
      code: current.weather_code ?? 0,
      // The API answers 1/0 rather than a boolean.
      isDay: current.is_day !== 0,
      wind: current.wind_speed_10m ?? 0,
    },
    days,
    units,
    place,
    fetchedAt: Date.now(),
  };
}
