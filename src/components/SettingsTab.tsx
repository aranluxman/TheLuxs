"use client";

import { useRef, useState } from "react";
import { usePrefs } from "@/hooks/usePrefs";
import { useProfileLock } from "@/hooks/useProfileLock";
import { downscaleImage } from "@/lib/image";
import { MEMBER_COLORS } from "@/lib/palette";
import {
  START_TABS,
  START_TAB_LABELS,
  WIDTHS,
  WIDTH_LABELS,
  type StartTab,
  type Width,
} from "@/lib/prefs";
import { THEMES, type ThemePreference } from "@/lib/themes";
import { useFamily } from "./FamilyProvider";
import { useTheme } from "./ThemeProvider";
import { Avatar, Button, Card, ErrorNote, inputClass } from "./ui";

/**
 * Settings.
 *
 * Deliberately one narrow column of small blocks rather than a page of panels:
 * everything here is a thing you change once and forget, so the whole tab
 * should be readable without scrolling on a tablet and take one tap per
 * decision.
 *
 * The split is per-*screen* above, per-*person* below. Theme and layout live in
 * `localStorage` because they describe the device you are holding; name, photo,
 * colour and PIN live in Postgres because they describe you, and the rest of
 * the household sees them.
 */

/* ------------------------------------------------------------------ block */

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-muted text-[11px] font-bold tracking-[0.12em] uppercase">{title}</h3>
      {hint ? <p className="text-faint mt-0.5 mb-2 text-xs">{hint}</p> : <div className="mb-2" />}
      <Card className="p-3">{children}</Card>
    </section>
  );
}

/** A row of mutually exclusive pills — the only control this tab uses twice. */
function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: (option: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            aria-pressed={active}
            className={`min-h-9 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              active
                ? "border-ink bg-ink text-on-ink"
                : "border-line text-muted hover:bg-sunk"
            }`}
          >
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

function ProfileBlock() {
  const { currentMember, updateMember, setMemberPhoto, clearMemberPhoto } = useFamily();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!currentMember) return null;
  const me = currentMember;

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    setError(await setMemberPhoto(me.id, await downscaleImage(file, 640)));
    setBusy(false);
  }

  return (
    <Block title="You" hint="Everyone in the house sees this.">
      <ErrorNote message={error} />

      <div className="flex items-center gap-3">
        <Avatar member={me} size="lg" ring />
        <div className="min-w-0 flex-1">
          <label htmlFor="settings-name" className="sr-only">
            Your name
          </label>
          <input
            id="settings-name"
            defaultValue={me.name}
            key={`name-${me.id}`}
            maxLength={40}
            onBlur={async (e) => {
              const v = e.target.value.trim();
              if (!v || v === me.name) return;
              setError(await updateMember(me.id, { name: v }));
            }}
            className={`${inputClass} py-2`}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={pickPhoto}
              className="hidden"
              aria-hidden
              tabIndex={-1}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-accent text-xs font-semibold disabled:opacity-50"
            >
              {busy ? "Uploading…" : me.avatar_url ? "Change photo" : "Upload a photo"}
            </button>
            {me.avatar_url ? (
              <button
                onClick={async () => {
                  setBusy(true);
                  setError(await clearMemberPhoto(me.id));
                  setBusy(false);
                }}
                className="text-faint hover:text-danger text-xs"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-line mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-faint text-xs">Colour</span>
        {MEMBER_COLORS.map((c) => (
          <button
            key={c}
            onClick={async () => setError(await updateMember(me.id, { color: c }))}
            className="h-6 w-6 rounded-full transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              boxShadow: me.color === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined,
            }}
            aria-label={`Use colour ${c}`}
            aria-pressed={me.color === c}
          />
        ))}
      </div>
    </Block>
  );
}

/* -------------------------------------------------------------------- PIN */

function PinBlock() {
  const { currentMember } = useFamily();
  const { status, setPin, forgetThisDevice } = useProfileLock();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!currentMember) return null;
  const me = currentMember;
  const hasPin = status[me.id]?.has_pin ?? false;

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length !== 4) {
      setError("A PIN is four digits.");
      return;
    }
    setBusy(true);
    setError(null);
    // `family_set_pin` requires the current PIN whenever one exists — that is
    // the whole point of the gate, so an empty box here is a server-side
    // rejection rather than something to work around.
    const r = await setPin(me.id, next, hasPin ? current : undefined);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "That did not work.");
      return;
    }
    setCurrent("");
    setNext("");
    setOpen(false);
    setNote(hasPin ? "PIN changed." : "PIN set.");
  }

  return (
    <Block
      title="Your PIN"
      hint={hasPin ? "Asked for on any device that has not been used before." : "Not set yet."}
    >
      <ErrorNote message={error} />
      {note ? (
        <p className="text-success mb-2 text-xs font-medium" role="status">
          {note}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="space-y-2">
          {hasPin ? (
            <>
              <label htmlFor="pin-current" className="sr-only">
                Current PIN
              </label>
              <input
                id="pin-current"
                value={current}
                onChange={(e) => setCurrent(digits(e.target.value))}
                inputMode="numeric"
                placeholder="Current PIN"
                className={`${inputClass} py-2 tracking-[0.3em] tabular-nums`}
                style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
              />
            </>
          ) : null}

          <label htmlFor="pin-next" className="sr-only">
            New PIN
          </label>
          <input
            id="pin-next"
            value={next}
            onChange={(e) => setNext(digits(e.target.value))}
            inputMode="numeric"
            placeholder={hasPin ? "New PIN" : "Choose a 4-digit PIN"}
            className={`${inputClass} py-2 tracking-[0.3em] tabular-nums`}
            style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="min-h-9 py-1.5 text-xs">
              {busy ? "Saving…" : hasPin ? "Change PIN" : "Set PIN"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
                setCurrent("");
                setNext("");
              }}
              className="min-h-9 py-1.5 text-xs"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            onClick={() => {
              setOpen(true);
              setNote(null);
            }}
            className="text-accent text-xs font-semibold"
          >
            {hasPin ? "Change PIN" : "Set a PIN"}
          </button>
          {hasPin ? (
            <button
              onClick={async () => {
                await forgetThisDevice(me.id);
                setNote("This device will ask for your PIN again.");
              }}
              className="text-faint hover:text-ink text-xs"
            >
              Forget this device
            </button>
          ) : null}
        </div>
      )}

      {hasPin ? (
        // Said plainly rather than hidden: a self-serve reset for a PIN you
        // cannot remember would let anyone holding the tablet clear anyone
        // else's, which is exactly what the PIN is for.
        <p className="text-faint border-line mt-3 border-t pt-2.5 text-[11px]">
          Forgotten it? It can only be cleared from the Supabase SQL editor —
          <code className="mx-1">select public.family_admin_clear_pin(&#39;{me.id}&#39;);</code>
          — so that nobody can reset someone else&rsquo;s from this screen.
        </p>
      ) : null}
    </Block>
  );
}

/* --------------------------------------------------------------------- tab */

export function SettingsTab() {
  const { preference, setPreference } = useTheme();
  const { prefs, setPrefs } = usePrefs();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="rule-accent">
        <p className="text-accent text-[11px] font-bold tracking-[0.14em] uppercase">
          This device
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Settings</h2>
      </div>

      <Block title="Page colour" hint="Applies to this device only.">
        <div className="grid grid-cols-2 gap-1.5">
          {THEMES.map((t) => {
            const active = preference === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setPreference(t.id)}
                aria-pressed={active}
                className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors ${
                  active ? "border-accent bg-accent-soft" : "border-line hover:bg-sunk"
                }`}
              >
                <span className="theme-swatch shrink-0" aria-hidden>
                  {t.swatch.map((c) => (
                    <span key={c} style={{ backgroundColor: c }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{t.label}</span>
                {active ? (
                  <span className="text-accent shrink-0 text-xs" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setPreference("system" as ThemePreference)}
          aria-pressed={preference === "system"}
          className={`mt-1.5 flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition-colors ${
            preference === "system" ? "border-accent bg-accent-soft" : "border-line hover:bg-sunk"
          }`}
        >
          <span aria-hidden>🖥️</span>
          <span className="flex-1 text-xs font-semibold">Match system</span>
          {preference === "system" ? (
            <span className="text-accent text-xs" aria-hidden>
              ✓
            </span>
          ) : null}
        </button>
      </Block>

      <Block title="Layout">
        <div className="space-y-3">
          <div>
            <p className="text-faint mb-1.5 text-xs">Opens on</p>
            <Choice<StartTab>
              options={START_TABS}
              value={prefs.startTab}
              onChange={(startTab) => setPrefs({ startTab })}
              label={(o) => START_TAB_LABELS[o]}
            />
          </div>
          <div>
            <p className="text-faint mb-1.5 text-xs">Content width</p>
            <Choice<Width>
              options={WIDTHS}
              value={prefs.width}
              onChange={(width) => setPrefs({ width })}
              label={(o) => WIDTH_LABELS[o]}
            />
          </div>
        </div>
      </Block>

      <ProfileBlock />
      <PinBlock />
    </div>
  );
}
