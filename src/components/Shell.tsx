"use client";

import { useState } from "react";
import { useFamily } from "./FamilyProvider";
import { ChoresTab } from "./ChoresTab";
import { EventsTab } from "./EventsTab";
import { CalendarTab } from "./CalendarTab";
import { ChatTab } from "./ChatTab";
import { ProfileSheet } from "./ProfileSheet";
import { Avatar } from "./ui";

const TABS = [
  { id: "chores", label: "Chores", icon: "🧽" },
  { id: "events", label: "Events", icon: "🎟️" },
  { id: "calendar", label: "Calendar", icon: "🗓️" },
  { id: "chat", label: "Chat", icon: "💬" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Shell() {
  const { currentMember, setCurrentMemberId } = useFamily();
  const [tab, setTab] = useState<TabId>("chores");
  const [profilesOpen, setProfilesOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-line bg-canvas/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <h1 className="text-base font-semibold">Family Dashboard</h1>

          {/* Tabs live in the header on desktop, in a bottom bar on phones. */}
          <nav className="mx-auto hidden gap-1 sm:flex" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id ? "bg-ink text-white" : "text-muted hover:bg-sunk"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <button
              onClick={() => setProfilesOpen(true)}
              className="hover:bg-sunk flex items-center gap-2 rounded-full py-1 pr-3 pl-1"
              title="Edit profiles and photos"
            >
              <Avatar member={currentMember} size="sm" ring />
              <span className="text-sm font-medium">{currentMember?.name}</span>
            </button>
            <button
              onClick={() => setCurrentMemberId(null)}
              className="text-faint hover:bg-sunk hover:text-ink rounded-full px-2 py-1 text-xs"
              title="Switch to another profile"
            >
              Switch
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 sm:pb-8">
        {tab === "chores" ? <ChoresTab /> : null}
        {tab === "events" ? <EventsTab /> : null}
        {tab === "calendar" ? <CalendarTab /> : null}
        {tab === "chat" ? <ChatTab /> : null}
      </main>

      <nav
        className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        aria-label="Sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
              tab === t.id ? "text-ink" : "text-faint"
            }`}
          >
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
