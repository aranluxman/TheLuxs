"use client";

import { useState } from "react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button, Modal } from "./ui";

/**
 * "Download app" in the header. It installs the dashboard as a real app —
 * its own icon, its own window, no browser chrome — and then removes itself,
 * because an install button inside an installed app is noise.
 *
 * Nothing renders on a browser that cannot install (desktop Firefox, say), or
 * once the app is already installed.
 */
export function InstallButton() {
  const { state, install } = useInstallPrompt();
  const [helpOpen, setHelpOpen] = useState(false);

  if (state === "hidden") return null;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => (state === "ios" ? setHelpOpen(true) : void install())}
        className="px-3 py-1.5 text-xs sm:text-sm"
        title="Install the dashboard as an app"
      >
        <span aria-hidden>⬇</span>
        <span className="hidden sm:inline">Download app</span>
        <span className="sm:hidden">Install</span>
      </Button>

      {/* iOS has no install API — Safari only offers Add to Home Screen. */}
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Add to your home screen">
        <ol className="text-muted list-decimal space-y-2 pl-5 text-sm">
          <li>
            Tap the <strong className="text-ink">Share</strong> button at the bottom of Safari —
            the square with an arrow coming out of it.
          </li>
          <li>
            Scroll down and tap <strong className="text-ink">Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong className="text-ink">Add</strong>. The dashboard now opens like any other
            app, with your family photo as its icon.
          </li>
        </ol>
        <p className="text-faint mt-4 text-xs">
          This only works in Safari. If you are reading this in Chrome on an iPhone, open the same
          page in Safari first.
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setHelpOpen(false)}>Got it</Button>
        </div>
      </Modal>
    </>
  );
}
