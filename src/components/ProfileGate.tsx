"use client";

import { tint } from "@/lib/palette";
import { useFamily } from "./FamilyProvider";

/** "Who's using this?" — the whole of the auth story, by design. */
export function ProfileGate() {
  const { members, setCurrentMemberId } = useFamily();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-12">
      <h1 className="text-center text-2xl font-semibold">Who&rsquo;s using this?</h1>
      <p className="text-muted mt-2 text-center text-sm">
        Pick your name. This device will remember you.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setCurrentMemberId(m.id)}
            className="border-line bg-surface flex flex-col items-center gap-3 rounded-2xl border p-6 transition-transform hover:-translate-y-0.5"
          >
            <span
              className="grid h-16 w-16 place-items-center rounded-full text-3xl"
              style={{ backgroundColor: tint(m.color, 0.16) }}
              aria-hidden
            >
              {m.avatar_emoji}
            </span>
            <span className="text-sm font-medium">{m.name}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
