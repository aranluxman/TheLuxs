"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Chrome's install event. Not in lib.dom yet, and only ever fired on browsers
 * that actually support installing.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /**
     * Stashed by the boot script in the layout. `beforeinstallprompt` usually
     * fires before React has mounted, and an event that is not captured is
     * gone for good — with it goes the ability to install at all.
     */
    __familyInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** Remembered so the button stays gone on a browser that installed silently. */
const INSTALLED_KEY = "family-dashboard:installed";

export type InstallState =
  /** Nothing to offer: already installed, or a browser that cannot install. */
  | "hidden"
  /** A real install prompt is waiting. */
  | "ready"
  /** iOS: no API, so the button explains Add to Home Screen instead. */
  | "ios";

/**
 * Installability is browser state, not React state — it arrives on events that
 * fire before the app mounts and can change while it runs — so it is read
 * through a store rather than mirrored into `useState`.
 */
const listeners = new Set<() => void>();

/** Set once the prompt has been used up; it cannot be shown twice. */
let spent = false;

function emit() {
  for (const listener of listeners) listener();
}

function isStandalone(): boolean {
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari's own flag, which predates the standard media query.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasInstalled(): boolean {
  try {
    return Boolean(window.localStorage.getItem(INSTALLED_KEY));
  } catch {
    // Storage disabled — worst case the button reappears after installing.
    return false;
  }
}

function rememberInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* nothing to remember it with */
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function snapshot(): InstallState {
  if (spent || isStandalone() || wasInstalled()) return "hidden";
  if (window.__familyInstallPrompt) return "ready";
  if (isIos()) return "ios";
  return "hidden";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  const onPrompt = (e: Event) => {
    e.preventDefault();
    window.__familyInstallPrompt = e as BeforeInstallPromptEvent;
    emit();
  };

  const onInstalled = () => {
    window.__familyInstallPrompt = null;
    rememberInstalled();
    emit();
  };

  // Also covers being installed from the browser's own menu rather than the
  // button in the header.
  const standalone = window.matchMedia?.("(display-mode: standalone)");
  const onDisplayChange = (e: MediaQueryListEvent) => {
    if (e.matches) onInstalled();
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  standalone?.addEventListener("change", onDisplayChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
    standalone?.removeEventListener("change", onDisplayChange);
  };
}

/** Nothing is installable during a static prerender. */
const serverSnapshot = (): InstallState => "hidden";

export function useInstallPrompt(): {
  state: InstallState;
  install: () => Promise<void>;
} {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const install = useCallback(async () => {
    const event = window.__familyInstallPrompt;
    if (!event) return;

    await event.prompt();
    const { outcome } = await event.userChoice;

    // A prompt is single-use whatever the answer, so the button has nothing
    // left to offer either way. Accepting also fires `appinstalled` — but not
    // on every browser, which is why the flag is written here too.
    window.__familyInstallPrompt = null;
    spent = true;
    if (outcome === "accepted") rememberInstalled();
    emit();
  }, []);

  return { state, install };
}
