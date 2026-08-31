"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Two reasons it exists: a browser will not offer
 * to install a web app without one, and with one a reload on a dead connection
 * still paints the app instead of the dinosaur.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration is not urgent, and doing it during startup competes with the
    // first data fetch on a slow phone.
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Blocked, unsupported, or served from file:// — the app works anyway,
        // it just cannot be installed.
      });
    }, 1_200);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
