import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import {
  SYSTEM_DARK,
  SYSTEM_LIGHT,
  THEMES,
  THEME_STORAGE_KEY,
  themeById,
} from "@/lib/themes";
import { APP_ICON_CACHE_KEY } from "@/lib/appIcon";
import "./globals.css";

/**
 * Inter for everything. It is the reference modern UI sans — even apertures,
 * a tall x-height that survives being read across a kitchen, and tabular
 * figures, which the agenda and the chore counts both lean on.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Family Dashboard",
  description: "Calendar, chores, shopping, photos and chat for the whole house.",
  applicationName: "Family Dashboard",
  // The default marks. A family photo uploaded in the app replaces these at
  // runtime; see src/lib/appIcon.ts.
  //
  // The SVG is listed first and every current browser prefers it, which is what
  // makes the tab icon sharp at any zoom. The PNGs stay as the fallback. Note
  // that src/app/icon.svg is *also* picked up by the App Router file
  // convention; listing it here as well is deliberate, so the precedence is
  // stated in the code rather than left to a convention.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Makes an iPhone open the home-screen copy without Safari's chrome, which
  // is the whole point of installing it.
  appleWebApp: { capable: true, title: "Family", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Overwritten at runtime by ThemeProvider once a preference resolves; this
  // is the value the very first paint uses.
  themeColor: themeById(SYSTEM_LIGHT).chrome,
  width: "device-width",
  initialScale: 1,
  // The chat input should not zoom the page on iOS.
  maximumScale: 1,
};

/**
 * Runs before first paint, ahead of React. Without it the page renders in the
 * default palette and then snaps to the chosen one on hydration — the classic
 * theme flash, and a nasty one on a kitchen tablet at night. Deliberately tiny
 * and dependency-free because it blocks rendering.
 *
 * It stamps both attributes the CSS keys on, including for the "system" case:
 * resolving the media query here rather than in CSS is what lets `globals.css`
 * hold one palette per `[data-theme]` block with no `prefers-color-scheme`
 * duplication behind each of them.
 *
 * The valid-id list is inlined from `THEMES` rather than hardcoded, so adding
 * a palette cannot leave this script rejecting it.
 */
const NO_FLASH_SCRIPT = `
(function () {
  var MODES = ${JSON.stringify(
    Object.fromEntries(THEMES.map((t) => [t.id, t.mode])),
  )};
  var choice = null;
  try {
    choice = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  } catch (e) {}
  if (!choice || !MODES[choice]) {
    choice = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? ${JSON.stringify(SYSTEM_DARK)}
      : ${JSON.stringify(SYSTEM_LIGHT)};
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", choice);
  root.setAttribute("data-mode", MODES[choice]);

  // The household's own icon, straight from the cache. React swaps in the
  // shared copy once it has one; this is only so the tab does not show the
  // default mark for a second first.
  try {
    var raw = localStorage.getItem(${JSON.stringify(APP_ICON_CACHE_KEY)});
    var icon = raw ? JSON.parse(raw) : null;
    if (icon && icon.dataUrl) {
      var link = document.createElement("link");
      link.setAttribute("data-family-icon", "");
      link.rel = "icon";
      link.href = icon.dataUrl;
      document.head.appendChild(link);
    }
  } catch (e) {}

  // Chrome fires this before React exists, and an install prompt that is not
  // captured is gone for the rest of the visit — with it, the ability to
  // install at all. Parked on window for the header button to pick up.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    window.__familyInstallPrompt = e;
  });
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="bg-canvas text-ink flex min-h-full flex-col">{children}</body>
    </html>
  );
}
