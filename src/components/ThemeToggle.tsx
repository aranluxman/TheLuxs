"use client";

import { useTheme } from "./ThemeProvider";

/**
 * One tap flips light ↔ dark and pins the choice. Long-press is not a thing on
 * a wall tablet, so "back to following the system" lives behind a shift-click
 * rather than a second control eating header space — a power-user escape
 * hatch, not the primary affordance.
 */
export function ThemeToggle() {
  const { preference, resolved, setPreference, toggle } = useTheme();

  const label =
    preference === "system"
      ? `Following your system (${resolved}). Click to switch to ${
          resolved === "dark" ? "light" : "dark"
        }.`
      : `${resolved === "dark" ? "Dark" : "Light"} mode. Click to switch; shift-click to follow your system.`;

  return (
    <button
      onClick={(e) => (e.shiftKey ? setPreference("system") : toggle())}
      className="text-muted hover:bg-sunk hover:text-ink grid h-9 w-9 place-items-center rounded-full text-base transition-colors"
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{resolved === "dark" ? "☀️" : "🌙"}</span>
      {/* Announces the state rather than the icon, which reads as decoration. */}
      <span className="sr-only">
        Theme: {preference === "system" ? `system (${resolved})` : resolved}
      </span>
    </button>
  );
}
