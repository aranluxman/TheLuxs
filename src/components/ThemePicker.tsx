"use client";

import { useEffect, useId, useRef, useState } from "react";
import { THEMES, type ThemePreference } from "@/lib/themes";
import { useTheme } from "./ThemeProvider";

/**
 * The palette switcher.
 *
 * A toggle was enough when there were two states. Four named palettes plus
 * "match my system" need names, a description and a preview, so this is a
 * proper menu — and the preview is the point: nobody picks "Emerald" from a
 * word, they pick it from the three dots next to it.
 *
 * Closing on outside-click uses `pointerdown` rather than `click` so the menu
 * is gone before the thing you pointed at reacts; on `click` the header
 * buttons underneath would fire with the menu still painted over them.
 */
export function ThemePicker() {
  const { preference, theme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: ThemePreference) {
    setPreference(next);
    setOpen(false);
  }

  const label =
    preference === "system"
      ? `Theme: matching your system (${theme.label})`
      : `Theme: ${theme.label}`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`${label}. Click to change.`}
        aria-label={`${label}. Click to change.`}
        className="hover:bg-sunk grid min-h-10 min-w-10 place-items-center rounded-full px-1.5 transition-colors"
      >
        <span className="theme-swatch" aria-hidden>
          {theme.swatch.map((c) => (
            <span key={c} style={{ backgroundColor: c }} />
          ))}
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Theme"
          className="theme-menu glass-panel border-line absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border shadow-2xl"
        >
          <p className="text-faint border-line border-b px-3.5 py-2.5 text-[10px] font-bold tracking-[0.14em] uppercase">
            Theme
          </p>

          <div className="p-1.5">
            {THEMES.map((t) => {
              const active = preference === t.id;
              return (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(t.id)}
                  className={`hover:bg-sunk flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-sunk" : ""
                  }`}
                >
                  <span className="theme-swatch shrink-0" aria-hidden>
                    {t.swatch.map((c) => (
                      <span key={c} style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.label}</span>
                    <span className="text-faint block truncate text-[11px]">{t.blurb}</span>
                  </span>
                  {active ? (
                    <span className="text-accent shrink-0 text-sm" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Separated from the palettes because it is a different kind of
              answer: not "use this one" but "stop asking me". */}
          <div className="border-line border-t p-1.5">
            <button
              role="menuitemradio"
              aria-checked={preference === "system"}
              onClick={() => choose("system")}
              className={`hover:bg-sunk flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                preference === "system" ? "bg-sunk" : ""
              }`}
            >
              <span className="text-muted grid h-[1.35rem] w-[1.35rem] shrink-0 place-items-center text-sm" aria-hidden>
                🖥️
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">Match system</span>
                <span className="text-faint block truncate text-[11px]">
                  Clean Light by day, Midnight by night.
                </span>
              </span>
              {preference === "system" ? (
                <span className="text-accent shrink-0 text-sm" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
