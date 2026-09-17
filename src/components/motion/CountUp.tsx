"use client";

import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

/**
 * A number that counts itself in when it first comes into view, and pops when
 * it changes afterwards — see `useCountUp` for why those are two different
 * animations rather than one.
 *
 * Always `tabular-nums`: a proportional font re-measures the line on every
 * frame of a count, and a dashboard number that jitters sideways while it
 * settles looks broken rather than lively.
 *
 * The rendered value is the live one, so a screen reader in an `aria-live`
 * region is not read the intermediate numbers — callers put the label, not
 * this, inside the live region.
 */
export function CountUp({
  value,
  className = "",
  suffix,
}: {
  value: number;
  className?: string;
  suffix?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>({ amount: 0.4 });
  const { display, bumping } = useCountUp(value, { start: inView });

  return (
    <span
      ref={ref}
      className={`count-up tabular-nums ${className}`}
      data-bump={bumping ? "true" : undefined}
    >
      {display}
      {suffix}
    </span>
  );
}
