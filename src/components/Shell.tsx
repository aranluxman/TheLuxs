"use client";

import { useState } from "react";
import { useFamily } from "./FamilyProvider";
import { EventsTab } from "./EventsTab";
import { CalendarTab } from "./CalendarTab";
import { ChatTab } from "./ChatTab";
import { ChoresTab } from "./ChoresTab";
import { ShoppingTab } from "./ShoppingTab";
import { ProfileSheet } from "./ProfileSheet";
import { ThemePicker } from "./ThemePicker";
import { Avatar } from "./ui";

const TABS = [
  { id: "calendar", label: "Calendar", icon: "🗓️" },
  { id: "chores", label: "Chores", icon: "🧹" },
  { id: "events", label: "Events", icon: "🎟️" },
  { id: "shopping", label: "Shopping", icon: "🛒" },
  { id: "chat", label: "Chat", icon: "💬" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Shell() {
  const { currentMember, setCurrentMemberId } = useFamily();
  // Chores used to open the app. The calendar is the thing everyone checks now.
  const [tab, setTab] = useState<TabId>("calendar");
  const [profilesOpen, setProfilesOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="app-header border-line bg-canvas/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <div className="brand-lockup flex items-center gap-2.5">
            <span className="brand-mark" aria-hidden>F</span>
            <div>
              <h1 className="text-sm font-bold tracking-tight sm:text-base">Family Dashboard</h1>
              <p className="text-faint hidden text-[10px] font-semibold tracking-[0.14em] uppercase sm:block">
                Together, in sync
              </p>
            </div>
          </div>

          {/* Tabs live in the header on desktop, in a bottom bar everywhere
              else. Five labelled tabs plus the brand and the profile controls
              do not fit one row until ~1024px, and a bottom bar is the native
              pattern on a tablet anyway — so the switch happens at `lg`.
              The glyphs are dropped up here: at five tabs they were the
              difference between fitting and wrapping, and unlike in the bottom
              bar they sit beside a label that already says the same thing. */}
          <nav className="mx-auto hidden gap-1 lg:flex" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] ${
                  tab === t.id ? "bg-ink text-on-ink shadow-sm" : "text-muted hover:bg-sunk"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <ThemePicker />
            {/* At 390px the brand lockup, theme picker, avatar, name and Switch
                all competed for one row and pushed Switch against the edge.
                Below `sm` the avatar alone identifies you — the name is one tap
                away in the sheet it opens. */}
            <button
              onClick={() => setProfilesOpen(true)}
              className="hover:bg-sunk flex min-h-11 items-center gap-2 rounded-full py-1 pr-1 pl-1 transition-colors sm:pr-3"
              title="Edit profiles and photos"
              aria-label={
                currentMember ? `Signed in as ${currentMember.name}. Edit profiles and photos.` : "Edit profiles and photos"
              }
            >
              <Avatar member={currentMember} size="sm" ring />
              <span className="hidden text-sm font-medium sm:inline">{currentMember?.name}</span>
            </button>
            <button
              onClick={() => setCurrentMemberId(null)}
              className="text-faint hover:bg-sunk hover:text-ink grid min-h-10 min-w-10 place-items-center rounded-full px-2 py-1 text-xs font-semibold transition-colors sm:px-3"
              title="Switch to another profile"
              aria-label="Switch to another profile"
            >
              <span aria-hidden className="sm:hidden">⇄</span>
              <span className="hidden sm:inline">Switch</span>
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 lg:pb-8">
        {tab === "calendar" ? <CalendarTab /> : null}
        {tab === "chores" ? <ChoresTab /> : null}
        {tab === "events" ? <EventsTab /> : null}
        {tab === "shopping" ? <ShoppingTab /> : null}
        {tab === "chat" ? <ChatTab /> : null}
      </main>

      <nav
        className="mobile-nav glass-panel border-line fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[10.5px] font-semibold transition-colors ${
              tab === t.id ? "text-ink" : "text-faint"
            }`}
          >
            {tab === t.id ? <span className="bg-accent absolute top-0 h-0.5 w-10 rounded-full" aria-hidden /> : null}
            <span className="text-lg" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <ProfileSheet open={profilesOpen} onClose={() => setProfilesOpen(false)} />
    </div>
  );
}
