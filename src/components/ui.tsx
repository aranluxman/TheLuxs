"use client";

import { useEffect, useRef, useState } from "react";
import { tint } from "@/lib/palette";
import type { MemberWithPhoto } from "@/lib/types";

/* ---------------------------------------------------------------- Avatar */

const AVATAR_SIZES = {
  /** Reaction pills — small enough to stack three abreast inside a chip. */
  xs: "h-4 w-4 text-[8px]",
  sm: "h-7 w-7 text-sm",
  md: "h-10 w-10 text-lg",
  lg: "h-14 w-14 text-2xl",
} as const;

export function Avatar({
  member,
  size = "md",
  ring = false,
  decorative = false,
}: {
  member: Pick<MemberWithPhoto, "avatar_emoji" | "color" | "name" | "avatar_url"> | null;
  size?: keyof typeof AVATAR_SIZES;
  ring?: boolean;
  /**
   * Set when the person's name is already written next to the avatar.
   *
   * Without it the name is announced twice in a row — the avatar carries it as
   * `alt`/`sr-only` so that a bare avatar is not anonymous, and the label beside
   * it carries it again. Worse, the `alt` text is *visible* whenever the photo
   * fails to load, so "Sukhi Luxman" sitting next to a broken avatar reads as
   * "Sukhi LuxmanSukhi Luxman" on screen, not just to a screen reader.
   */
  decorative?: boolean;
}) {
  // A signed avatar URL expires after eight hours, and this app is left open on
  // a kitchen tablet for days. When one lapses the browser would otherwise
  // render the alt text inside the circle; falling back to the emoji keeps the
  // row looking like a row.
  const [broken, setBroken] = useState(false);

  if (!member) {
    return (
      <span
        className={`${AVATAR_SIZES[size]} bg-sunk text-faint grid shrink-0 place-items-center rounded-full`}
        aria-hidden
      >
        ?
      </span>
    );
  }

  const shell = `${AVATAR_SIZES[size]} grid shrink-0 place-items-center overflow-hidden rounded-full`;
  const shadow = ring ? `0 0 0 2px ${member.color}` : undefined;

  // A real photo beats an emoji every time — that was the whole point of
  // adding them. The emoji stays as the fallback.
  if (member.avatar_url && !broken) {
    return (
      <span
        className={shell}
        style={{ boxShadow: shadow }}
        title={decorative ? undefined : member.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={member.avatar_url}
          alt={decorative ? "" : member.name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={shell}
      style={{ backgroundColor: tint(member.color, 0.16), boxShadow: shadow }}
      title={decorative ? undefined : member.name}
    >
      <span aria-hidden>{member.avatar_emoji}</span>
      {decorative ? null : <span className="sr-only">{member.name}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ Chip */

export function MemberChip({ member }: { member: MemberWithPhoto }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: tint(member.color, 0.14), color: member.color }}
    >
      <span aria-hidden>{member.avatar_emoji}</span>
      {member.name}
    </span>
  );
}

/* ---------------------------------------------------------------- Button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  // `press` owns the lift and the tap squash — hover only where there is a
  // pointer, so a phone does not leave a button looking stuck after a tap. See
  // the .press rules in globals.css.
  const base =
    "press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold " +
    "transition-[background-color,border-color,color,transform,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-45 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const variants = {
    primary: "bg-ink text-on-ink shadow-sm hover:shadow-md",
    ghost: "border border-line bg-surface text-ink shadow-sm hover:bg-sunk",
    danger: "text-danger hover:bg-danger-soft",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}

/* ------------------------------------------------------------------ Card */

/**
 * Passes the rest of its props through to the div, which is what lets a caller
 * set `style` (the chore board drives its left-edge colour through a custom
 * property) or a `data-*` attribute the stylesheet keys on, without every such
 * case needing a new named prop here.
 */
export function Card({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`dashboard-card border-line bg-surface rounded-xl border ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-muted text-[11px] font-bold tracking-[0.12em] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="text-muted flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="bg-accent/12 grid h-12 w-12 place-items-center rounded-2xl text-2xl" aria-hidden>
        {icon}
      </span>
      <p className="text-ink text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-xs text-xs">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1.5 block text-xs font-bold tracking-wide">{label}</span>
      {children}
      {hint ? <span className="text-faint mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm text-ink shadow-sm " +
  "placeholder:text-faint focus:border-accent focus:ring-accent/20 focus:outline-none focus:ring-4";

/* ----------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * Closing is animated, which means the panel has to outlive `open` by the
   * length of the animation. `phase` is that extra life: React is told to keep
   * rendering while it is "closing", and the element is dropped when the timer
   * ends rather than the moment the prop flips.
   *
   * Everything else — Escape, the focus move, the scroll lock — keys off
   * `open`, so a dialog on its way out is already inert.
   */
  const [phase, setPhase] = useState<"shut" | "open" | "closing">(open ? "open" : "shut");

  // Both transitions are adjusted during render rather than in an effect: they
  // are state derived from a prop changing, and an effect would paint one frame
  // of the old phase first — which for the opening case is a frame of a dialog
  // that has not started animating yet.
  if (open && phase !== "open") setPhase("open");
  if (!open && phase === "open") setPhase("closing");

  useEffect(() => {
    if (phase !== "closing") return;
    const id = setTimeout(() => setPhase("shut"), 220);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Focus the first control so keyboard users land inside the dialog.
    panelRef.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (phase === "shut") return null;

  const closing = phase === "closing";

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4 ${
        closing ? "modal-backdrop-out" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // A panel on its way out must not swallow a tap meant for what is behind
      // it — by this point the dialog is gone as far as the app is concerned.
      style={closing ? { pointerEvents: "none" } : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`bg-surface max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 shadow-2xl sm:rounded-3xl sm:p-6 ${
          // On a phone this is a bottom sheet, so it arrives and leaves the way
          // a sheet does; on a desktop it is a dialog and scales in place.
          closing ? "sheet-down sm:modal-out" : "sheet-up sm:modal-panel"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:bg-sunk grid h-10 w-10 place-items-center rounded-full text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Messages */

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="bg-danger-soft text-danger mb-3 rounded-xl px-3 py-2 text-xs" role="alert">
      {message}
    </p>
  );
}
