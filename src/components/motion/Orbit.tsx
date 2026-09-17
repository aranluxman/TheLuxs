"use client";

import { usePageVisible } from "@/hooks/useInView";
import { tint } from "@/lib/palette";
import type { MemberWithPhoto } from "@/lib/types";

/**
 * The family, slowly circling home.
 *
 * Above "Who's using this?", which is the first thing anybody sees and was
 * otherwise a heading over a grid. Everyone in the house is on the ring in
 * their own colour, turning around the app's own mark — the same mark that was
 * already sitting there, now with somewhere to be the centre of.
 *
 * Two rotations in opposite directions — the ring of faces one way over 40s,
 * a dashed ring the other way over 70s — because a single rotation reads as a
 * loading spinner. Each avatar counter-rotates at the same speed as its ring,
 * so a face stays upright the whole way round rather than tumbling.
 *
 * Entirely decorative: `aria-hidden`, and the picker below says everything this
 * does in words. It stops when the tab is hidden.
 */
export function Orbit({
  members,
  center,
}: {
  members: MemberWithPhoto[];
  /** What the family circles. Defaults to a house. */
  center?: React.ReactNode;
}) {
  const visible = usePageVisible();

  // Five is the size of this house; more than six on a 390px ring is a clump
  // rather than an orbit, so the rest simply do not ride.
  const riders = members.slice(0, 6);
  if (riders.length === 0) return null;

  return (
    <div className="orbit" data-paused={!visible ? "true" : undefined} aria-hidden>
      <span className="orbit-ring" />
      <span className="orbit-dashes" />

      <span className="orbit-home">
        <span className="orbit-home-glyph">{center ?? "🏠"}</span>
      </span>

      <span className="orbit-riders">
        {riders.map((m, i) => (
          <span
            key={m.id}
            className="orbit-slot"
            style={{ "--orbit-angle": `${(360 / riders.length) * i}deg` } as React.CSSProperties}
          >
            <span
              className="orbit-avatar"
              style={{
                backgroundColor: tint(m.color, 0.22),
                borderColor: m.color,
              }}
            >
              {/*
               * Two counter-rotations, not one, and they undo different things.
               * The ring's own turn is cancelled by the reverse animation on
               * `.orbit-avatar`; the slot's fixed angle — the thing that parks
               * this face at four o'clock rather than twelve — is cancelled
               * here. Without this second one every face sits permanently
               * tipped by its position on the rim.
               */}
              <span className="orbit-face">
                {m.avatar_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={m.avatar_url}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="orbit-initial" style={{ color: m.color }}>
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}
