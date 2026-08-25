"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_PREFS,
  PREFS_STORAGE_KEY,
  parsePrefs,
  type Prefs,
} from "@/lib/prefs";

/**
 * The same arrangement `ThemeProvider` uses, without the provider: these are
 * read in two places, so a context would be ceremony around a `localStorage`
 * key.
 *
 * `localStorage` fires no event in the tab that wrote it, so writes are
 * announced here; the browser's own `storage` event covers the other tabs,
 * which is what keeps two windows on one tablet in step.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// `useSyncExternalStore` compares snapshots by identity and re-renders forever
// if each read returns a new object, so the parsed value is cached and only
// replaced when the underlying string actually changes.
let cachedRaw: string | null = null;
let cachedPrefs: Prefs = DEFAULT_PREFS;

function getSnapshot(): Prefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    // Private mode or storage disabled — the choice just will not persist.
    return DEFAULT_PREFS;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parsePrefs(raw);
  }
  return cachedPrefs;
}

/**
 * What the prerendered HTML assumes. Returning the defaults keeps hydration
 * free of a mismatch; the stored values land on the first client render, which
 * is before anything is interactive.
 */
const getServerSnapshot = (): Prefs => DEFAULT_PREFS;

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    const next = { ...getSnapshot(), ...patch };
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Nothing to persist to. Announcing anyway would re-render with the old
      // value and make the tap look ignored, so leave it and let the caller's
      // control stay where it was.
      return;
    }
    for (const listener of listeners) listener();
  }, []);

  return { prefs, setPrefs };
}
