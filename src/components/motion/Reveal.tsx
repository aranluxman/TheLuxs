"use client";

import { useInView } from "@/hooks/useInView";

/**
 * Content that arrives rather than appears.
 *
 * Two modes, and the difference matters on a dashboard whose first screen is
 * already full:
 *
 *   on mount     for anything above the fold — it is on screen by definition,
 *                so waiting for an intersection would only delay it
 *   in view      for anything below — the leaderboard bars and the chore cards
 *                should not have played their entrance while nobody was there
 *
 * `delay` is what makes a stagger: the caller passes `i * 60`, so the list
 * arranges itself rather than each row deciding when it belongs. Kept to a
 * handful of items — a stagger over twenty rows is a queue, not a flourish.
 *
 * Reduced motion is handled entirely in CSS (`.reveal` has no animation under
 * the media query), so the element is simply there. Nothing here needs to
 * branch on it.
 */
export function Reveal({
  children,
  delay = 0,
  when = "mount",
  as: Tag = "div",
  className = "",
}: {
  children: React.ReactNode;
  /** Milliseconds. */
  delay?: number;
  when?: "mount" | "in-view";
  as?: "div" | "section" | "li" | "span";
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLElement>({ amount: 0.15 });

  const active = when === "mount" || inView;

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`${active ? "reveal" : "reveal-idle"} ${className}`}
      style={{ animationDelay: active && delay ? `${delay}ms` : undefined }}
    >
      {children}
    </Tag>
  );
}
