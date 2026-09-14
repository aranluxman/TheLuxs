"use client";

import { useRef, useState } from "react";
import {
  notificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/hooks/useMessageNotifications";
import { usePrefs } from "@/hooks/usePrefs";
import { useProfileLock } from "@/hooks/useProfileLock";
import { downscaleImage } from "@/lib/image";
import { MEMBER_COLORS } from "@/lib/palette";
import {
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  DEFAULT_PLACE,
  START_TABS,
  START_TAB_LABELS,
  TEXT_SIZES,
  TEXT_SIZE_LABELS,
  UNITS,
  UNITS_LABELS,
  WIDTHS,
  WIDTH_LABELS,
  type CalendarView,
  type StartTab,
  type TextSize,
  type Units,
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

/**
 * A labelled on/off row. The only other control this tab needs, and the one
 * every "show me less of this" setting is made of.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 py-1.5 ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className="tick-box peer-focus-visible:ring-accent/50 mt-0.5 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
        data-done={checked}
        aria-hidden
      >
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="text-faint block text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}

/* --------------------------------------------------------------- weather */

/**
 * Where the weather panel reports from.
 *
 * A coordinate box rather than a place search: resolving a name means a
 * geocoding service, which is a second thing that can be down and a second
 * thing to explain. "Use my location" covers the case anyone actually has, and
 * the default is home.
 */
function WeatherBlock() {
  const { prefs, setPrefs } = usePrefs();
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setNote("This device will not share a location.");
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPrefs({
          weatherPlace: {
            label: "Here",
            // Three decimals is about 100m, which is far finer than a forecast
            // grid and keeps the stored value from being a precise home address.
            lat: Number(pos.coords.latitude.toFixed(3)),
            lon: Number(pos.coords.longitude.toFixed(3)),
          },
        });
        setLocating(false);
        setNote("Using this device's location.");
      },
      () => {
        setLocating(false);
        setNote("The browser would not share a location.");
      },
      { timeout: 10_000 },
    );
  }

  const isHome =
    prefs.weatherPlace.lat === DEFAULT_PLACE.lat && prefs.weatherPlace.lon === DEFAULT_PLACE.lon;

  return (
    <Block title="Weather" hint="Shown at the top of the calendar.">
      <Toggle
        label="Show the weather"
        checked={prefs.showWeather}
        onChange={(showWeather) => setPrefs({ showWeather })}
      />

      <div className="border-line mt-2 border-t pt-2.5">
        <p className="text-faint mb-1.5 text-xs">Units</p>
        <Choice<Units>
          options={UNITS}
          value={prefs.units}
          onChange={(units) => setPrefs({ units })}
          label={(o) => UNITS_LABELS[o]}
        />
      </div>

      <div className="border-line mt-3 border-t pt-2.5">
        <p className="text-faint mb-1.5 text-xs">
          Reporting from <span className="text-ink font-medium">{prefs.weatherPlace.label}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setPrefs({ weatherPlace: DEFAULT_PLACE })}
            aria-pressed={isHome}
            className={`min-h-9 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              isHome ? "border-ink bg-ink text-on-ink" : "border-line text-muted hover:bg-sunk"
            }`}
          >
            {DEFAULT_PLACE.label}
          </button>
          <button
            onClick={useMyLocation}
            disabled={locating}
            className="border-line text-muted hover:bg-sunk min-h-9 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {locating ? "Finding…" : "Use my location"}
          </button>
        </div>
        {note ? (
          <p className="text-faint mt-1.5 text-[11px]" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </Block>
  );
}

/* ---------------------------------------------------------- notifications */

function NotificationsBlock() {
  const { prefs, setPrefs } = usePrefs();
  // Read once into state rather than on every render: `Notification.permission`
  // is a browser global, and reading it during render would make this component
  // render differently on the server than on the client.
  const [permission, setPermission] = useState<NotificationPermissionState>("default");
  const [checked, setChecked] = useState(false);

  if (!checked) {
    setChecked(true);
    setPermission(notificationPermission());
  }

  const blocked = permission === "denied";
  const unsupported = permission === "unsupported";

  async function enable() {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") setPrefs({ notifyMessages: true });
  }

  return (
    <Block title="Notifications" hint="Only on this device.">
      <Toggle
        label="Tell me about new messages"
        hint={
          unsupported
            ? "This browser cannot show notifications."
            : blocked
              ? "Blocked in the browser's site settings — turn it back on there first."
              : permission === "granted"
                ? "A banner when somebody messages you or the group."
                : "Needs permission first."
        }
        checked={prefs.notifyMessages && permission === "granted"}
        disabled={unsupported || blocked}
        onChange={(on) => {
          if (!on) {
            setPrefs({ notifyMessages: false });
            return;
          }
          if (permission === "granted") setPrefs({ notifyMessages: true });
          else void enable();
        }}
      />

      <Toggle
        label="Play a sound"
        hint="Off by default — a kitchen is loud enough."
        checked={prefs.notifySound}
        disabled={!prefs.notifyMessages || permission !== "granted"}
        onChange={(notifySound) => setPrefs({ notifySound })}
      />

      <p className="text-faint border-line mt-2 border-t pt-2.5 text-[11px]">
        The dot on the Chat tab appears either way — it needs no permission, and
        it is what the house sees if this is switched off.
      </p>
    </Block>
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
        // Two plain buttons and nothing else.
        //
        // There used to be a paragraph here explaining that a forgotten PIN can
        // only be cleared from the Supabase SQL editor, with the statement to
        // run. It was true and it is still true — there is deliberately no
        // self-serve reset, because one would let anyone holding the tablet
        // clear anyone else's — but printing the recovery path on the lock
        // itself told every reader that a way in exists and what it is called.
        // The people who need it know where it is.
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setOpen(true);
              setNote(null);
            }}
            className="min-h-9 py-1.5 text-xs"
          >
            {hasPin ? "Change PIN" : "Set a PIN"}
          </Button>
          {hasPin ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await forgetThisDevice(me.id);
                setNote("This device will ask for your PIN again.");
              }}
              className="min-h-9 py-1.5 text-xs"
            >
              Forget this device
            </Button>
          ) : null}
        </div>
      )}
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
          <div>
            <p className="text-faint mb-1.5 text-xs">Text size</p>
            <Choice<TextSize>
              options={TEXT_SIZES}
              value={prefs.textSize}
              onChange={(textSize) => setPrefs({ textSize })}
              label={(o) => TEXT_SIZE_LABELS[o]}
            />
          </div>
          <div>
            <p className="text-faint mb-1.5 text-xs">Calendar opens as</p>
            <Choice<CalendarView>
              options={CALENDAR_VIEWS}
              value={prefs.calendarView}
              onChange={(calendarView) => setPrefs({ calendarView })}
              label={(o) => CALENDAR_VIEW_LABELS[o]}
            />
          </div>
        </div>
      </Block>

      <Block title="On the calendar page" hint="Hide what this screen does not need.">
        <Toggle
          label="Quote of the day"
          checked={prefs.showQuote}
          onChange={(showQuote) => setPrefs({ showQuote })}
        />
        <Toggle
          label="Family photos"
          checked={prefs.showPhotos}
          onChange={(showPhotos) => setPrefs({ showPhotos })}
        />
      </Block>

      <WeatherBlock />
      <NotificationsBlock />

      <ProfileBlock />
      <PinBlock />
    </div>
  );
}
