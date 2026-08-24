"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  SYSTEM_DARK,
  SYSTEM_LIGHT,
  THEME_STORAGE_KEY,
  isThemeId,
  themeById,
  type ThemeDefinition,
  type ThemeId,
  type ThemePreference,
} from "@/lib/themes";

export { THEME_STORAGE_KEY } from "@/lib/themes";

/**
 * Five states, not two: the four named palettes plus "system", which is the
 * default and follows the OS. Picking a palette is a deliberate override that
 * outlives the session.
 *
 * "system" is represented by *removing* the stored key rather than by writing
 * a fifth value, so a browser that has never seen this app and one whose owner
 * chose "match my system" are indistinguishable — there is no state to
 * migrate if the default ever changes.
 */

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What that resolves to right now — never "system". */
  theme: ThemeDefinition;
  setPreference: (next: ThemePreference) => void;
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
    return isThemeId(raw) ? raw : "system";
  } catch {
    // Private mode / storage disabled — the choice just will not persist.
    return "system";
  }
}

/**
 * What the prerendered HTML assumes. The bootstrap script has already painted
 * the right colours by this point; returning "system" here only means the
 * picker's tick settles a beat later, and it keeps hydration free of a
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

  const resolvedId: ThemeId =
    preference === "system" ? (systemDark ? SYSTEM_DARK : SYSTEM_LIGHT) : preference;
  const theme = themeById(resolvedId);

  // Keep the DOM attributes in step. The bootstrap script sets both before
  // first paint; this takes over once React is running. `data-mode` is what
  // `color-scheme` and the `dark:` variant key on — see `globals.css`.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme.id);
    root.setAttribute("data-mode", theme.mode);
  }, [theme]);

  // The browser chrome (iOS status bar, Android address bar) reads this, and
  // a static `themeColor` in the metadata cannot follow a runtime switch.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme.chrome;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal on its own, but the snapshot would then keep reporting the
      // old value and the UI would appear to ignore the tap — so fall back to
      // driving the attributes directly and leave the preference unpersisted.
      const root = document.documentElement;
      const fallback = themeById(
        next === "system"
          ? window.matchMedia(SCHEME_QUERY).matches
            ? SYSTEM_DARK
            : SYSTEM_LIGHT
          : next,
      );
      root.setAttribute("data-theme", fallback.id);
      root.setAttribute("data-mode", fallback.mode);
      return;
    }
    for (const listener of listeners) listener();
  }, []);

  const value = useMemo(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
