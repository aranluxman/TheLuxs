"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

/**
 * Three states, not two. "system" is the default and follows the OS; picking
 * light or dark is a deliberate override that outlives the session. The CSS in
 * `globals.css` is written so that `data-theme` absent means "follow the
 * media query", which is why system is represented by removing the attribute
 * rather than by stamping a third value.
 */
export type ThemePreference = "light" | "dark" | "system";

/** Must match the key read by the bootstrap script in `layout.tsx`. */
export const THEME_STORAGE_KEY = "family-dashboard:theme";

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What that resolves to right now — never "system". */
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
  /** Light → dark → light. Always lands on an explicit choice. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/* --------------------------------------------------------- stored choice */

/**
 * `localStorage` has no change event for the tab that wrote it, so writes are
 * announced here. The browser's own `storage` event covers the other tabs,
 * which is what keeps two windows on the same tablet in step.
 */
const listeners = new Set<() => void>();

function subscribePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function preferenceSnapshot(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    // Private mode / storage disabled — the choice just will not persist.
    return "system";
  }
}

/**
 * What the prerendered HTML assumes. The bootstrap script has already painted
 * the right colours by this point; returning "system" here only means the
 * toggle's icon settles a beat later, and it keeps hydration free of a
 * mismatch that React would otherwise have to discard the tree over.
 */
const preferenceServerSnapshot = (): ThemePreference => "system";

/* ------------------------------------------------------- system fallback */

const SCHEME_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  const query = window.matchMedia(SCHEME_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const schemeSnapshot = () => window.matchMedia(SCHEME_QUERY).matches;
const schemeServerSnapshot = () => false;

/* ---------------------------------------------------------------- provider */

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Both of these are genuinely external stores — one is the OS, the other is
  // storage that another tab can write. `useSyncExternalStore` is what keeps
  // them consistent across a concurrent render instead of tearing.
  const preference = useSyncExternalStore(
    subscribePreference,
    preferenceSnapshot,
    preferenceServerSnapshot,
  );
  const systemDark = useSyncExternalStore(
    subscribeScheme,
    schemeSnapshot,
    schemeServerSnapshot,
  );

  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Keep the DOM attribute in step. The bootstrap script sets it before first
  // paint; this takes over once React is running.
  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
  }, [preference]);

  // The browser chrome (iOS status bar, Android address bar) reads this, and
  // a static `themeColor` in the metadata cannot follow a runtime toggle.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolved === "dark" ? "#12100e" : "#f6f4f0";
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal on its own, but the snapshot would then keep reporting the
      // old value and the UI would appear to ignore the tap — so fall back to
      // driving the attribute directly and leave the preference unpersisted.
      const root = document.documentElement;
      if (next === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", next);
      return;
    }
    for (const listener of listeners) listener();
  }, []);

  const toggle = useCallback(
    () => setPreference(resolved === "dark" ? "light" : "dark"),
    [resolved, setPreference],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
