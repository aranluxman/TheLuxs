"use client";

import { useEffect, useRef, useState } from "react";

interface Options {
  /** How much of the element has to be showing before it counts. */
  amount?: number;
  /**
   * Whether the answer may go back to false once it has been true.
   *
   * Off by default, because almost everything here is a reveal: a leaderboard
   * bar that has grown should stay grown, and re-running it every time the
   * page scrolls past would turn a nice touch into a twitch.
   */
  repeat?: boolean;
}

/**
 * "Is this on screen?" — the trigger for reveals, count-ups and the bars on the
 * chore leaderboard, and the off-switch for anything that loops.
 *
 * One observer per element rather than a shared one: the elements using this
 * are counted in tens, and a registry would be more machinery than the thing it
 * manages. Falls back to "yes, it is visible" where IntersectionObserver is
 * missing, so content can never be left invisible by a missing API.
 */
export function useInView<T extends Element = HTMLDivElement>(
  { amount = 0.2, repeat = false }: Options = {},
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer to ask — an older browser, or a test environment. Show the
    // content rather than leave it held back forever. Deferred by a frame so
    // the update lands outside the commit.
    if (typeof IntersectionObserver === "undefined") {
      const raf = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(raf);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (!repeat) observer.disconnect();
        } else if (repeat) {
          setInView(false);
        }
      },
      { threshold: amount },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [amount, repeat]);

  return { ref, inView };
}

/**
 * "Is this tab being looked at?"
 *
 * Infinite animations — the orbit on the picker, the Up next ticker, the live
 * dot — keep a compositor awake and, on a phone, keep the radio and the GPU
 * from idling. A backgrounded tab has nobody watching, so they stop.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    // A tab that was already hidden when this mounted — a prerendered page
    // restored into the background — is caught on the next frame rather than
    // synchronously, so the subscription is all the effect body does.
    const raf = requestAnimationFrame(onChange);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  return visible;
}
