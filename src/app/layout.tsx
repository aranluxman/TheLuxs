import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Family Dashboard",
  description: "Events, calendar and chat for the whole house.",
};

export const viewport: Viewport = {
  // Overwritten at runtime by ThemeProvider once a preference resolves; this
  // is the value the very first paint uses.
  themeColor: "#f6f4f0",
  width: "device-width",
  initialScale: 1,
  // The chat input should not zoom the page on iOS.
  maximumScale: 1,
};

/**
 * Runs before first paint, ahead of React. Without it the page renders in the
 * light palette and then snaps to dark on hydration — the classic theme flash,
 * and a nasty one on a kitchen tablet at night. Deliberately tiny and
 * dependency-free because it blocks rendering.
 *
 * Absent attribute means "follow the OS", which is exactly what the CSS
 * expects, so the system case writes nothing at all.
 */
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var choice = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (choice === "light" || choice === "dark") {
      document.documentElement.setAttribute("data-theme", choice);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="bg-canvas text-ink flex min-h-full flex-col">{children}</body>
    </html>
  );
}
