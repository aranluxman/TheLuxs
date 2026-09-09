"use client";

import { useRef } from "react";
import { useAppIcon } from "./AppIconProvider";
import { BrandMark } from "./BrandMark";
import { Button, ErrorNote, Modal } from "./ui";

/**
 * Swaps the app's icon for a family photo. Opened from the mark in the header,
 * which is where anyone would click to change it.
 */
export function AppIconSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { iconUrl, scope, busy, error, setIcon, clearIcon } = useAppIcon();
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await setIcon(file);
  }

  return (
    <Modal open={open} onClose={onClose} title="App icon">
      <ErrorNote message={error} />

      <div className="flex items-center gap-5">
        <span className="border-line bg-sunk grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-3xl border">
          {iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={iconUrl} alt="The current app icon" className="h-full w-full object-cover" />
          ) : (
            <BrandMark title="The default app icon" className="h-full w-full" />
          )}
        </span>

        <div className="flex flex-col items-start gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={pick}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Saving…" : iconUrl ? "Choose a different photo" : "Upload a family photo"}
          </Button>
          {iconUrl ? (
            <button
              onClick={() => void clearIcon()}
              disabled={busy}
              className="text-faint hover:text-ink text-xs disabled:opacity-45"
            >
              Back to the default icon
            </button>
          ) : null}
        </div>
      </div>

      <div className="text-muted mt-5 space-y-2 text-xs">
        <p>
          The photo is cropped to a square from the centre and shrunk before it is saved, so
          pick one where everyone is in the middle.
        </p>
        <p>
          It becomes the mark in this header and the icon on the browser tab. On an iPhone it
          also becomes the home-screen icon the next time the app is added; an Android launcher
          keeps the default house icon, because that one is baked into the build.
        </p>
        {scope === "device" ? (
          <p className="text-accent">
            Saved on this device only. Run the migration in{" "}
            <code className="font-mono">supabase/migrations/0005_app_settings.sql</code> to share
            it with everyone&rsquo;s phone.
          </p>
        ) : (
          <p>Everyone in the house sees this icon.</p>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
