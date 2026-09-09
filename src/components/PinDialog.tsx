"use client";

import { useEffect, useRef, useState } from "react";
import { tint } from "@/lib/palette";
import type { MemberWithPhoto } from "@/lib/types";
import { Avatar, Button, Modal } from "./ui";

export type PinMode = "unlock" | "create";

interface Props {
  open: boolean;
  mode: PinMode;
  member: MemberWithPhoto | null;
  busy: boolean;
  error: string | null;
  /** Seconds remaining on a server-side cooldown, if one is running. */
  lockedFor: number | null;
  onClose: () => void;
  /** `confirm` is only supplied when creating. */
  onSubmit: (pin: string) => void;
}

/**
 * Four digits, one field.
 *
 * A single `inputMode="numeric"` box rather than four separate ones: split
 * boxes need focus-juggling that goes wrong on mobile keyboards and with
 * password managers, and they read worse to a screen reader. The digits are
 * spaced with letter-spacing so it still looks like a PIN pad.
 *
 * Creating a PIN asks twice. A typo you cannot see, on a secret with no reset
 * path short of the SQL editor, is worth one extra step.
 */
export function PinDialog({
  open, mode, member, busy, error, lockedFor, onClose, onSubmit,
}: Props) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // No state is reset here. ProfileGate keys this component on the member and
  // mode, so a different person or purpose remounts it with fresh state —
  // which is what React's `key` is for, and avoids a cascading render.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open]);

  if (!member) return null;

  const creating = mode === "create";
  const value = stage === "confirm" ? confirm : pin;
  const locked = typeof lockedFor === "number" && lockedFor > 0;

  function handleChange(next: string) {
    const digits = next.replace(/\D/g, "").slice(0, 4);
    setLocalError(null);
    if (stage === "confirm") setConfirm(digits);
    else setPin(digits);
    if (digits.length === 4) void advance(digits);
  }

  async function advance(digits: string) {
    if (busy || locked) return;

    if (creating && stage === "enter") {
      setStage("confirm");
      setConfirm("");
      setTimeout(() => inputRef.current?.focus(), 40);
      return;
    }
    if (creating && stage === "confirm") {
      if (digits !== pin) {
        setLocalError("Those two PINs are different. Start again.");
        setPin("");
        setConfirm("");
        setStage("enter");
        setTimeout(() => inputRef.current?.focus(), 40);
        return;
      }
    }
    onSubmit(creating ? pin : digits);
  }

  const heading = creating
    ? stage === "enter"
      ? `Create ${member.name}'s PIN`
      : "Type it once more"
    : `${member.name}'s PIN`;

  const blurb = creating
    ? "Four digits. You will need it on any device that has not been used before."
    : "This device will remember you afterwards.";

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={heading}>
      <div className="flex flex-col items-center text-center">
        <span
          className="mb-3 grid h-16 w-16 place-items-center rounded-full text-3xl"
          style={{ backgroundColor: tint(member.color, 0.16) }}
        >
          {member.avatar_url ? <Avatar member={member} size="lg" /> : member.avatar_emoji}
        </span>

        <p className="text-muted mb-5 max-w-xs text-sm">{blurb}</p>

        <label htmlFor="pin-field" className="sr-only">
          {creating && stage === "confirm" ? "Confirm the four-digit PIN" : "Four-digit PIN"}
        </label>
        <input
          id="pin-field"
          ref={inputRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          // Not `type="password"`: browsers offer to save it as an account
          // password, which this is not. The characters are masked below.
          type="text"
          disabled={busy || locked}
          aria-invalid={Boolean(error || localError)}
          aria-describedby="pin-message"
          className="border-line bg-surface focus:border-accent w-48 rounded-2xl border py-3 text-center text-2xl font-bold tracking-[0.6em] tabular-nums focus:outline-none disabled:opacity-50"
          style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
          placeholder="••••"
        />

        <p
          id="pin-message"
          role="status"
          aria-live="polite"
          className={`mt-3 min-h-5 text-xs ${
            error || localError ? "text-danger font-medium" : "text-faint"
          }`}
        >
          {locked
            ? `Too many tries. Wait ${lockedFor} second${lockedFor === 1 ? "" : "s"}.`
            : (localError ?? error ?? (busy ? "Checking…" : " "))}
        </p>

        <div className="mt-5 flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
