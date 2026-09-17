"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * A short burst, for the two moments in this app that are actually an
 * achievement: the last thing ticked off the shopping list, and a chore board
 * with nothing left on it.
 *
 * Twenty pieces of coloured paper, each a `<span>` given a direction and a
 * delay, thrown outward and down over 1.2s and then removed from the DOM
 * entirely — no library, no canvas, no requestAnimationFrame, and nothing left
 * behind to keep a layer alive.
 *
 * Colours come from the household's own palette, so it looks like this app in
 * all nine themes rather than like a party store in one of them.
 *
 * Under `prefers-reduced-motion` it never mounts anything at all.
 */
const PIECES = 20;

export function Confetti({
  /** Flip to true to fire. Firing again needs a new `burstKey`. */
  burstKey,
  colors,
}: {
  burstKey: string | number;
  colors: string[];
}) {
  const reduced = useReducedMotion();
  const [alive, setAlive] = useState(true);
  const [firedFor, setFiredFor] = useState(burstKey);

  // A new burst re-arms the pieces. Adjusted during render rather than in an
  // effect: it is state derived from a prop changing, and an effect would let
  // one frame of the previous, already-faded burst through first.
  if (burstKey !== firedFor) {
    setFiredFor(burstKey);
    setAlive(true);
  }

  // Deterministic per burst rather than per render: React may render twice in
  // development, and a re-roll mid-flight would restart every piece.
  const pieces = useMemo(() => {
    const palette = colors.length ? colors : ["var(--color-accent)"];
    return Array.from({ length: PIECES }, (_, i) => {
      // Spread across the width, thrown up and out, tumbling as it falls.
      const angle = (i / PIECES) * 360;
      const spread = 30 + ((i * 37) % 90);
      return {
        id: i,
        color: palette[i % palette.length],
        x: `${Math.round(Math.cos((angle * Math.PI) / 180) * spread)}px`,
        y: `${Math.round(60 + ((i * 53) % 90))}px`,
        rotate: `${((i * 97) % 360) - 180}deg`,
        delay: `${(i % 6) * 40}ms`,
        left: `${6 + ((i * 17) % 88)}%`,
      };
    });
    // burstKey is the seed: a new burst is a new set of pieces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey, colors]);

  // The pieces are removed from the DOM once they have landed: a finished
  // animation still costs a layer, and this one sits over a card that stays on
  // screen afterwards.
  useEffect(() => {
    const id = setTimeout(() => setAlive(false), 1400);
    return () => clearTimeout(id);
  }, [burstKey]);

  if (reduced || !alive) return null;

  return (
    <span className="confetti" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: p.left,
              backgroundColor: p.color,
              animationDelay: p.delay,
              "--confetti-x": p.x,
              "--confetti-y": p.y,
              "--confetti-rotate": p.rotate,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
