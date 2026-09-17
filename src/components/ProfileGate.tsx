"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProfileLock } from "@/hooks/useProfileLock";
import { tint } from "@/lib/palette";
import type { MemberWithPhoto } from "@/lib/types";
import { Orbit } from "./motion/Orbit";
import { Reveal } from "./motion/Reveal";
import { useFamily } from "./FamilyProvider";
import { PinDialog, type PinMode } from "./PinDialog";
import { ErrorNote } from "./ui";

/**
 * "Who's using this?" — now with a PIN in front of each profile.
 *
 * Three ways a tap can go:
 *   • this device has already been trusted for that person → straight in
 *   • they have a PIN and this device has not → ask for it
 *   • they have no PIN yet → ask them to create one
 *
 * The trust check is a round trip rather than anything cached locally: the
 * whole point is that the answer cannot be arranged from the browser.
 */
export function ProfileGate() {
  const { members, setCurrentMemberId } = useFamily();
  const lock = useProfileLock();

  const [pending, setPending] = useState<MemberWithPhoto | null>(null);
  const [mode, setMode] = useState<PinMode>("unlock");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState<number | null>(null);

  // Ticks a server-issued cooldown down to zero so the field re-enables itself.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (lockedFor === null) return;
    timer.current = setInterval(() => {
      setLockedFor((s) => (s === null || s <= 1 ? null : s - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [lockedFor]);

  const choose = useCallback(
    async (member: MemberWithPhoto) => {
      setPinError(null);
      setLockedFor(null);

      const hasPin = lock.status[member.id]?.has_pin ?? false;
      if (!hasPin) {
        setMode("create");
        setPending(member);
        return;
      }

      setChecking(member.id);
      const trusted = await lock.isTrustedHere(member.id);
      setChecking(null);

      if (trusted) {
        setCurrentMemberId(member.id);
        return;
      }
      setMode("unlock");
      setPending(member);
    },
    [lock, setCurrentMemberId],
  );

  async function submitPin(pin: string) {
    if (!pending) return;
    setBusy(true);
    setPinError(null);

    const result =
      mode === "create"
        ? await lock.setPin(pending.id, pin)
        : await lock.unlock(pending.id, pin);

    setBusy(false);

    if (result.ok) {
      setPending(null);
      setCurrentMemberId(pending.id);
      return;
    }
    if (result.retryAfterSeconds) setLockedFor(result.retryAfterSeconds);
    setPinError(
      result.error ??
        (result.attemptsLeft !== undefined
          ? `That is not the right PIN. ${result.attemptsLeft} ${
              result.attemptsLeft === 1 ? "try" : "tries"
            } left.`
          : "That is not the right PIN."),
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-md text-center">
        {/* Everyone in the house, slowly circling home. Decorative — the
            picker below says all of it in words — and the first thing the
            screen does, because this is the one page nobody is in a hurry on. */}
        <Orbit
          members={members}
          center={<span className="brand-mark !h-11 !w-11 text-base">F</span>}
        />

        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">Welcome home</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Who&rsquo;s using this?</h1>
        <p className="text-muted mt-2 text-center text-sm">
          Pick your name and enter your PIN. This device will remember you afterwards.
        </p>
      </div>

      <ErrorNote message={lock.error} />

      <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {members.map((m, i) => {
          const hasPin = lock.status[m.id]?.has_pin ?? false;
          const isChecking = checking === m.id;
          return (
            // 70ms apart: enough for the eye to follow along the row, short
            // enough that the last face is in before anyone has decided.
            <Reveal key={m.id} delay={i * 70}>
            <button
              onClick={() => void choose(m)}
              disabled={isChecking || lock.loading}
              style={{ "--profile-hue": m.color } as React.CSSProperties}
              aria-label={
                hasPin
                  ? `${m.name}. Protected by a PIN.`
                  : `${m.name}. No PIN yet — you will be asked to create one.`
              }
              className="dashboard-card profile-card border-line bg-surface relative flex h-full min-h-36 w-full flex-col items-center justify-center gap-3 rounded-2xl border p-5 disabled:opacity-60"
            >
              {m.avatar_url ? (
                <span className="h-16 w-16 overflow-hidden rounded-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
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

              {/* A profile with no PIN is called out, so the household can see
                  at a glance who still needs to set one. */}
              <span
                className="profile-lock text-faint absolute top-2.5 right-3 inline-block text-[10px] font-semibold"
                aria-hidden
              >
                {isChecking ? "…" : hasPin ? "🔒" : "Set a PIN"}
              </span>
            </button>
            </Reveal>
          );
        })}
      </div>

      <PinDialog
        // Remounts per person and per purpose, which is what clears the
        // previously typed digits — see the note in PinDialog.
        key={`${pending?.id ?? "none"}:${mode}`}
        open={pending !== null}
        mode={mode}
        member={pending}
        busy={busy}
        error={pinError}
        lockedFor={lockedFor}
        onClose={() => {
          setPending(null);
          setPinError(null);
          setLockedFor(null);
        }}
        onSubmit={(pin) => void submitPin(pin)}
      />
    </main>
  );
}
