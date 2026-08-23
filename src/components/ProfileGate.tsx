"use client";

import { tint } from "@/lib/palette";
import { useFamily } from "./FamilyProvider";

/** "Who's using this?" — the whole of the auth story, by design. */
export function ProfileGate() {
  const { members, setCurrentMemberId } = useFamily();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-md text-center">
        <div className="brand-mark mx-auto mb-5" aria-hidden>F</div>
        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Welcome home</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Who&rsquo;s using this?</h1>
        <p className="text-muted mt-2 text-center text-sm">
          Pick your name. This device will remember you.
        </p>
      </div>

      <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setCurrentMemberId(m.id)}
            className="dashboard-card border-line bg-surface flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border p-5 transition-transform hover:-translate-y-1"
          >
            {m.avatar_url ? (
              <span className="h-16 w-16 overflow-hidden rounded-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </span>
            ) : (
              <span
                className="grid h-16 w-16 place-items-center rounded-full text-3xl"
                style={{ backgroundColor: tint(m.color, 0.16) }}
                aria-hidden
              >
                {m.avatar_emoji}
              </span>
            )}
            <span className="text-sm font-medium">{m.name}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
