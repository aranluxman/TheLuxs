import type { MetadataRoute } from "next";

/**
 * Makes the dashboard installable — without a manifest naming real icons and
 * a `standalone` display mode, Chrome never fires `beforeinstallprompt` and
 * the "Install app" button in the header has nothing to offer.
 *
 * Emitted as a static file by the export, alongside the `<link rel="manifest">`
 * tag Next adds for us.
 *
 * The icons here are the *defaults*. A family photo uploaded from inside the
 * app replaces the tab icon and the iOS home-screen icon at runtime, but it
 * cannot rewrite this file, so an Android launcher keeps the house mark.
 */
// `output: export` has no server to run route handlers on, so this one has to
// declare itself static — the manifest is the same file for everybody anyway.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Dashboard",
    short_name: "Family",
    description: "Events, calendar and chat for the whole house.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4f0",
    theme_color: "#f6f4f0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
