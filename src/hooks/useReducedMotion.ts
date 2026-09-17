"use client";

import { useSyncExternalStore } from "react";

/**
 * "Does this person want motion?"
 *
 * Most of the animation in this app is CSS, where `prefers-reduced-motion` is
 * answered in the stylesheet and nothing needs to know. This hook is for the
 * handful of places where the *JavaScript* has to behave differently: a
 * counter that must start at its final value rather than count up, a confetti
 * burst that must not be spawned at all, a marquee that must not be measured.
 *
 * Read through `useSyncExternalStore` so it tracks the OS setting live — the
 * kitchen tablet is never reloaded, and someone turning the setting on should
 * not have to restart the app to feel it.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * The server has no preference to read. `false` matches the prerendered HTML,
 * and the real answer lands on the first client render — before anything has
 * had a chance to move.
 */
const getServerSnapshot = (): boolean => false;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
