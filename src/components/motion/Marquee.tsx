"use client";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useInView, usePageVisible } from "@/hooks/useInView";

/**
 * A strip that scrolls what is coming up next.
 *
 * The mechanics that make it seamless: the list is rendered twice and the track
 * is moved from 0 to -50%. At the moment the first copy has fully left, the
 * second copy is exactly where the first started, so the reset is invisible and
 * there is no jump to hide. The duplicate is `aria-hidden` — a screen reader
 * should hear today's events once.
 *
 * It stops when it is off screen or the tab is hidden. An animation nobody can
 * see still keeps a compositor awake, and this one is on the first screen of a
 * tablet that stays on all day.
 *
 * One or zero items never scroll: a single event sliding past is harder to read
 * than the same event sitting still, and there is nothing to cycle through.
 */
export function Marquee({
  items,
  /** Seconds for one full pass. Scaled by the caller to the number of items. */
  duration = 38,
  className = "",
  label,
}: {
  items: React.ReactNode[];
  duration?: number;
  className?: string;
  label: string;
}) {
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const { ref, inView } = useInView<HTMLDivElement>({ amount: 0.1, repeat: true });

  if (items.length === 0) return null;

  const separator = (
    <span className="text-accent px-3 select-none" aria-hidden>
      ✦
    </span>
  );

  /*
   * Nothing worth moving, or nobody who wants movement.
   *
   * The static list wraps rather than running off the edge — under
   * `prefers-reduced-motion` this is the *only* way these events are shown, so
   * a line clipped by the mask would be information that reader never gets.
   * Capped at three: past that the strip stops being a strip.
   */
  if (items.length === 1 || reduced) {
    return (
      <div ref={ref} className={`marquee marquee-plain ${className}`} aria-label={label}>
        <div className="marquee-static">
          {items.slice(0, 3).map((item, i) => (
            <span key={i} className="inline-flex items-center">
              {i > 0 ? separator : null}
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const run = (hidden: boolean) => (
    <div className="marquee-run" aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center whitespace-nowrap">
          {item}
          {separator}
        </span>
      ))}
    </div>
  );

  return (
    <div
      ref={ref}
      className={`marquee ${className}`}
      // Hovering reads one line; touching holds it still long enough to read
      // the rest. Both are the same "wait, what was that" gesture.
      data-paused={!inView || !visible ? "true" : undefined}
      aria-label={label}
    >
      <div className="marquee-track" style={{ animationDuration: `${duration}s` }}>
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}
