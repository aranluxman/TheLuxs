"use client";

import { useEffect, useMemo, useState } from "react";
import { useMessageNotifications } from "@/hooks/useMessageNotifications";
import { usePrefs } from "@/hooks/usePrefs";
import { useTabActivity, type ActivityTab } from "@/hooks/useTabActivity";
import { TEXT_SIZE_ROOT_PX, WIDTH_CLASS } from "@/lib/prefs";
import { useFamily } from "./FamilyProvider";
import { CalendarTab } from "./CalendarTab";
import { ChatTab } from "./ChatTab";
import { ChoresTab } from "./ChoresTab";
import { TodosTab } from "./TodosTab";
import { ShoppingTab } from "./ShoppingTab";
import { SettingsTab } from "./SettingsTab";
import { ProfileSheet } from "./ProfileSheet";
import { ThemePicker } from "./ThemePicker";
import { AppIconSheet } from "./AppIconSheet";
import { BrandMark } from "./BrandMark";
import { InstallButton } from "./InstallButton";
import { useAppIcon } from "./AppIconProvider";
import { Avatar } from "./ui";

const TABS = [
  { id: "calendar", label: "Calendar", icon: "🗓️" },
  { id: "todos", label: "To Do's", icon: "✅" },
  { id: "chores", label: "Chores", icon: "🧹" },
  { id: "shopping", label: "Shopping", icon: "🛒" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "settings", label: "Settings", icon: "⚙️" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Settings is excluded: it has no "new since you looked" activity.
 *
 * Chat is excluded from *this* mechanism too, but for the opposite reason — it
 * has so much that it gets its own. `useTabActivity` marks a tab seen by
 * opening it, which is right for a board and wrong for a conversation that has
 * already been read; `useMessageNotifications` tracks the chat instead, and
 * also does the notifying.
 */
const ACTIVITY_TABS = new Set<string>(["calendar", "todos", "chores", "shopping"]);

function isActivityTab(id: TabId): id is ActivityTab {
  return ACTIVITY_TABS.has(id);
}

/** "Something happened here since you last looked." */
function NavDot() {
  return (
    <span className="bg-accent ring-canvas absolute -top-0.5 -right-1 h-2 w-2 rounded-full ring-2">
      <span className="sr-only">New activity</span>
    </span>
  );
}

export function Shell() {
  const { currentMember, members, setCurrentMemberId } = useFamily();
  const { iconUrl } = useAppIcon();
  const { prefs } = usePrefs();
  // Which tab opens is a per-device setting; the calendar is the default.
  // Read once as the initial value rather than tracked, so changing it in
  // Settings does not yank the tab out from under whoever is changing it — it
  // takes effect on the next visit, which is what "opens on" means.
  const [tab, setTab] = useState<TabId>(() => prefs.startTab);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);

  const width = WIDTH_CLASS[prefs.width];

  const { unseen, markSeen } = useTabActivity();

  const { unread: chatUnread, setNames } = useMessageNotifications(
    currentMember?.id ?? null,
    tab === "chat",
  );

  // The notification body says who sent it, and the alert hook has no reason
  // to hold the member list itself.
  const memberNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of members) out[m.id] = m.name;
    return out;
  }, [members]);
  useEffect(() => setNames(memberNames), [memberNames, setNames]);

  /**
   * Text size is a root font-size, because every measurement in the app is in
   * `rem` through Tailwind — so one number here scales the whole interface,
   * including the things nobody would remember to add a class to.
   */
  useEffect(() => {
    const px = TEXT_SIZE_ROOT_PX[prefs.textSize];
    document.documentElement.style.fontSize = `${px}px`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [prefs.textSize]);

  // Opening a tab is what marks it seen — including the one the app opens on,
  // which is why this runs on mount as well as on every switch.
  useEffect(() => {
    if (isActivityTab(tab)) markSeen(tab);
  }, [tab, markSeen]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="app-header border-line bg-canvas/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className={`mx-auto flex w-full ${width} items-center gap-3 px-4 py-3`}>
          {/* The mark doubles as the way in to changing it. It is the app's own
              icon rather than a monogram, so the header, the browser tab and
              the home screen all show the same thing — and it is vector, so it
              stays sharp at any pixel ratio. */}
          <button
            onClick={() => setIconOpen(true)}
            className="brand-lockup hover:bg-sunk -m-1 flex items-center gap-2.5 rounded-xl p-1 text-left"
            title="Change the app icon"
          >
            {iconUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={iconUrl}
                alt=""
                className="border-line h-8 w-8 rounded-[0.625rem] border object-cover"
              />
            ) : (
              <BrandMark title={null} className="h-8 w-8 rounded-[0.625rem]" />
            )}
            <div>
              <h1 className="text-sm font-bold tracking-tight sm:text-base">Family Dashboard</h1>
              <p className="text-faint hidden text-[10px] font-semibold tracking-[0.14em] uppercase sm:block">
                Together, in sync
              </p>
            </div>
          </button>

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
                className={`relative inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] ${
                  tab === t.id ? "bg-ink text-on-ink shadow-sm" : "text-muted hover:bg-sunk"
                }`}
              >
                {t.label}
                {/* Only on a tab you are not already looking at — the one on
                    screen is seen by definition, and a dot there would blink on
                    and off as rows arrive under you. */}
                {tab !== t.id && isActivityTab(t.id) && unseen[t.id] ? <NavDot /> : null}
                {tab !== "chat" && t.id === "chat" && chatUnread ? <NavDot /> : null}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <InstallButton />
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

      <main className={`dashboard-main mx-auto w-full ${width} flex-1 px-4 pt-5 pb-24 lg:pb-8`}>
        {tab === "calendar" ? <CalendarTab /> : null}
        {tab === "todos" ? <TodosTab /> : null}
        {tab === "chores" ? <ChoresTab /> : null}
        {tab === "shopping" ? <ShoppingTab /> : null}
        {tab === "chat" ? <ChatTab /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
      </main>

      <nav
        className="mobile-nav glass-panel border-line fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
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
            <span className="relative text-lg" aria-hidden>
              {t.icon}
              {tab !== t.id && isActivityTab(t.id) && unseen[t.id] ? <NavDot /> : null}
              {tab !== "chat" && t.id === "chat" && chatUnread ? <NavDot /> : null}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <ProfileSheet open={profilesOpen} onClose={() => setProfilesOpen(false)} />
      <AppIconSheet open={iconOpen} onClose={() => setIconOpen(false)} />
    </div>
  );
}
