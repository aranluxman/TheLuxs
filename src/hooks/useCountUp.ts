"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/** Ease-out cubic: fast first, settling gently. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface Options {
  /** How long the first run takes. */
  duration?: number;
  /** Hold at 0 until this turns true — used with `useInView`. */
  start?: boolean;
}

/**
 * A number that counts up to its value, and pops when it changes afterwards.
 *
 * Two different animations, deliberately:
 *
 *   first paint   0 → value over a second, so a dashboard fills in rather than
 *                 arriving fully formed
 *   a later change  no count at all — the number is replaced and the *element*
 *                 pops (see `.count-pop`). Counting 3 → 4 over a second would
 *                 be a slow way to say "one more", and after a sync the value
 *                 has already changed as far as the house is concerned.
 *
 * Under `prefers-reduced-motion` the value is simply the value, always.
 */
export function useCountUp(value: number, { duration = 1000, start = true }: Options = {}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const [bumping, setBumping] = useState(false);

  // Whether the first count-up has already run; a change after that is a pop.
  const counted = useRef(false);

  useEffect(() => {
    if (reduced || !start) return;

    let raf: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /*
     * Every path starts inside a frame rather than in the effect body. It costs
     * one frame nobody can see, and it keeps state updates out of the commit —
     * an effect that sets state synchronously re-renders the tree twice for
     * every tick of a counter, which on a dashboard with several of them is a
     * real cost for no visible difference.
     */
    if (counted.current) {
      raf = requestAnimationFrame(() => {
        setDisplay(value);
        setBumping(true);
        timer = setTimeout(() => setBumping(false), 340);
      });
    } else {
      counted.current = true;
      const startedAt = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        setDisplay(Math.round(value * easeOutCubic(t)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [value, duration, start, reduced]);

  /*
   * The value wins outright when motion is unwanted, or before the count has
   * been allowed to start — a number that sits at 0 until it scrolls into view
   * would be wrong, not merely still.
   */
  return {
    display: reduced || !start ? value : display,
    bumping: bumping && !reduced,
  };
}
