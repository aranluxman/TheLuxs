"use client";

import { useEffect, useRef } from "react";
import { tint } from "@/lib/palette";
import type { FamilyMember } from "@/lib/types";

/* ---------------------------------------------------------------- Avatar */

const AVATAR_SIZES = {
  sm: "h-7 w-7 text-sm",
  md: "h-10 w-10 text-lg",
  lg: "h-14 w-14 text-2xl",
} as const;

export function Avatar({
  member,
  size = "md",
  ring = false,
}: {
  member: Pick<FamilyMember, "avatar_emoji" | "color" | "name"> | null;
  size?: keyof typeof AVATAR_SIZES;
  ring?: boolean;
}) {
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
  return (
    <span
      className={`${AVATAR_SIZES[size]} grid shrink-0 place-items-center rounded-full`}
      style={{
        backgroundColor: tint(member.color, 0.16),
        boxShadow: ring ? `0 0 0 2px ${member.color}` : undefined,
      }}
      title={member.name}
    >
      <span aria-hidden>{member.avatar_emoji}</span>
      <span className="sr-only">{member.name}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Chip */

export function MemberChip({ member }: { member: FamilyMember }) {
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
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium " +
    "transition-colors disabled:cursor-not-allowed disabled:opacity-45 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const variants = {
    primary: "bg-ink text-white hover:bg-ink/85",
    ghost: "border border-line bg-surface text-ink hover:bg-sunk",
    danger: "text-red-700 hover:bg-red-50",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}

/* ------------------------------------------------------------------ Card */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border-line bg-surface rounded-2xl border ${className}`}>{children}</div>
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
      <h2 className="text-muted text-xs font-semibold tracking-[0.08em] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="text-muted flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="text-3xl" aria-hidden>
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
      <span className="text-muted mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
      {hint ? <span className="text-faint mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink " +
  "placeholder:text-faint focus:border-ink focus:outline-none";

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="bg-surface max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:bg-sunk grid h-8 w-8 place-items-center rounded-full text-xl leading-none"
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
    <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
      {message}
    </p>
  );
}
