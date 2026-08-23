# Family Dashboard

Events, a shared calendar and a group chat for a five-person household —
one page, three tabs, live on every device in the house.

Built with **Next.js 16 (App Router, TypeScript)**, **Tailwind CSS v4**,
**Supabase** (Postgres + Realtime) and deployed as a **static site on Cloudflare Pages**.

---

## What each tab does

| Tab | What it does |
| --- | --- |
| **Calendar** | An agenda of what is actually coming up, over the next 2 weeks, 4 weeks or 3 months. Posted events and everyone's schedule entries merge into one chronological list, grouped by day. Tabs across the top switch between *Everyone* and one person, so anyone can pull up just their own week. |
| **Events** | The family activity board — movie night, the CNE, a trip downtown. Title, date/time, location, notes, and a per-person RSVP checklist (Going / Maybe / Can't). |
| **Chat** | An iMessage-style group thread — grouped bubbles, day separators, timestamps, sender colours, and live delivery over Supabase Realtime. Photos, files and voice notes attach to messages; tap any message to react with 👍 ❤️ 😂; you can delete your own. |

Every screen also carries a **profile photo** per person, and the Calendar tab
opens with a quote of the day, the next thing on the family's calendar, and
what each person says they're looking forward to.

The whole app has a **light and dark theme** with a manual toggle in the header
(the 🌙/☀️ button). The choice persists per device; shift-clicking the toggle
hands control back to the operating system.

There is no login. You pick your face once and the device remembers you — see
[Security model](#security-model) for what that means and how to tighten it.

---

## Theming

Every colour in the app resolves through a CSS variable declared in
`globals.css` — `bg-surface` is `var(--color-surface)`, and so on. Dark mode
redefines those variables under `:root[data-theme="dark"]`; no component
carries a `dark:` override for colour.

Three states, not two:

| `data-theme` | Behaviour |
| --- | --- |
| absent | Follow the OS (`prefers-color-scheme`) |
| `light` | Pinned light, even on a dark OS |
| `dark` | Pinned dark, even on a light OS |

The choice lives in `localStorage` under `family-dashboard:theme`, and a small
blocking script in `layout.tsx` applies it **before first paint** — without it
the page renders light and snaps to dark on hydration, which is exactly the
flash you notice on a kitchen tablet at night. `ThemeProvider` reads both the
stored choice and the OS preference through `useSyncExternalStore`, so the
`storage` event keeps two open tabs in step for free.

Two tokens exist purely to keep dark mode free of per-component patches:
`--color-on-ink` (text sitting on an ink-filled button or your own chat bubble)
and `--color-danger` / `--color-danger-soft` (destructive affordances, which
would otherwise hardcode Tailwind's `red-50`/`red-800` and glare in the dark).

---

## The other moving parts

### Profile photos

Each person can upload a photo from **their name in the header → Profiles**.
Pictures are downscaled to 640px in the browser before upload — a phone camera
shot is several megabytes and an avatar renders at 56px — and land in a
**private** Supabase Storage bucket (`family-media`). The app hands out
short-lived signed URLs rather than permanent public links. Removing a photo
deletes the underlying object, and replacing one cleans up the old file.

### Chat attachments and voice notes

The paperclip sends any file; images render inline, everything else becomes a
download chip with its size. The microphone records a voice note with
`MediaRecorder` (Opus in WebM, falling back to MP4 for Safari), capped at five
minutes, and plays back inline.

**Retention:** nothing is ever purged. The thread loads the most recent 60
messages and pages backwards through the whole history with *Load earlier
messages*.

**Deleting:** you can delete **your own** messages, and it deletes for
everyone. A confirmation prompt comes first, because there is no undo. The row
survives as a tombstone reading "Message deleted by …" so the conversation
keeps its shape, but the text, every attachment column *and the storage object
itself* are removed — a soft delete that left the photo in the bucket was not
really a delete, since anyone still holding a signed URL kept working access
to it.

Ownership is enforced in the query, not in the component: the update carries
`.eq("sender_id", me)`, so a stale UI matches no row and changes nothing. Note
that this is a *correctness* guard, not a *security* one — see
[Security model](#security-model).

### Reactions

Tap any message to open a picker with a fixed palette: 👍 ❤️ 😂. Tapping the
same emoji again removes yours. Each tally under a bubble shows the faces of
who reacted, which beats a bare count in a five-person house — you can see
whether the person you care about laughed.

Reactions live in `family_message_reactions`, keyed
`(message_id, member_id, emoji)`. That composite primary key is the whole
design: one person can both heart *and* laugh at a message, toggling one does
not disturb the other, and two devices tapping at once collapse into the same
row instead of colliding. The palette is closed by a `CHECK` constraint as
well as by the `REACTION_EMOJI` constant, so widening it means changing both.

Toggles are optimistic and roll back if the write fails. Realtime carries the
change to every other device; the table has `REPLICA IDENTITY FULL` so a
`DELETE` payload arrives with enough of the old row to know which pill to
remove.

### Combining everyone's calendars

**Calendar → Feeds** subscribes each person's calendar so they all overlay on
one grid, colour-coded by whose it is. Two ways in:

- **A live link** — Google Calendar → *Settings* → *Integrate calendar* →
  *Secret address in iCal format*. Apple and Outlook publish a similar URL.
  `webcal://` works. These re-sync on their own — see below — and on demand
  via *Sync*.
- **A pasted `.ics` file** — a one-off import that doesn't refresh by itself.

Fetching and parsing happen in the `family-sync-ical` Edge Function, not the
browser, for two reasons: calendar providers almost never send CORS headers, so
a browser can't read those URLs; and expanding a repeating event needs a real
RRULE implementation (it uses `ical.js`). Occurrences are expanded across a
window of 30 days back to 12 months ahead, and each sync replaces that window
wholesale so upstream cancellations disappear too.

**Automatic refresh.** With the Calendar tab open, `useCalendarAutoSync` pulls
every active feed once on mount, then every 30 minutes, and again whenever the
tab returns to the foreground after 15 minutes away. Because each sync replaces
a feed's whole window rather than diffing it, a redundant run is harmless —
which is what makes it safe for several devices in the house to poll
independently. A run that fails leaves the previously imported entries in
place, so the calendar degrades to *slightly stale* rather than to empty.

Imported entries are read-only in the app — deleting one locally would just
bring it back on the next sync. Remove the feed instead, which takes its events
with it.

To deploy the function after changing it:

```bash
npx supabase functions deploy family-sync-ical --project-ref <your-ref>
```

### Housekeeping

Storage now cleans up after itself: deleting a message removes its object from
the bucket, and a message whose upload succeeded but whose row insert failed
has its orphan removed too.

One thing is still worth knowing:

- Feed syncs are driven by an open browser. If nobody opens the dashboard for a
  week the calendar goes stale until someone does. If you want them to run
  regardless, `pg_cron` plus `pg_net` (already installed) can POST to the Edge
  Function on a schedule.

## Setup

### 1. Database

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql) and
run [`supabase/migrations/0001_family_dashboard.sql`](supabase/migrations/0001_family_dashboard.sql).

Then run, in order:

- `supabase/migrations/0002_media_quotes_ical.sql` — profile photos, chat
  attachments, quotes and calendar feeds.
- `supabase/migrations/0003_family_message_reactions.sql` — message reactions
  and the missing indexes. **The chat needs this one**; without it every
  reaction fails with *Could not find the table
  'public.family_message_reactions' in the schema cache*.
- `supabase/migrations/0004_remove_chores.sql` — removes the retired chores
  feature. Optional and destructive; see the note below.

All four are idempotent — safe to re-run. `0001`–`0003` leave you with:

- `family_members`, `family_events`, `family_event_rsvps`,
  `family_calendar_entries`, `family_messages`, `family_message_reactions`,
  `family_quotes`, `family_looking_forward`, `family_calendar_feeds`
- RLS policies on all nine tables
- Realtime on `family_messages` and `family_message_reactions`
- the private `family-media` storage bucket and its policy
- 28 seeded quotes

> **Upgrading an existing install.** `0004` **drops** `family_chores`,
> `family_chore_templates`, `family_chore_exclusions`, the
> `family_generate_chores()` / `family_regenerate_future_chores()` /
> `family_set_chore_done()` functions and the `family_recurrence` enum. That
> deletes your chore history for good. Take a backup first if you want to keep
> the record of who did what — nothing in the app reads those tables any more,
> so leaving `0004` unrun costs you only the disk they sit on.

> **Table naming.** Every object is prefixed `family_` because this Supabase
> project is shared with other apps that follow the same convention
> (`life_flow_*`, `myday_*`, `alux_*`). Nothing here touches those tables.

No family members are seeded — the app's first-run screen creates them, which is
also what establishes the order they appear in every picker and filter.

### 2. Environment variables

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Both are in **Project Settings → Data API / API Keys**.

Supabase is migrating from the legacy JWT `anon` key to `sb_publishable_…` keys.
The app accepts either — set `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead if you are
still on the old one. If both are present the publishable key wins.

> These are `NEXT_PUBLIC_*`, so they are **inlined at build time**. Changing them
> means rebuilding — restarting is not enough. If a build goes out without them,
> the app renders an explanatory screen rather than a blank page.

### 3. Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

First load walks you through naming the household, then asks who you are.

Useful scripts:

```bash
npm run build        # static export into ./out
npm run lint
npm run typecheck
npm run deploy       # build + push to Cloudflare Pages
```

---

## Push to GitHub

If you are starting from a fresh copy of these files:

```bash
git init
git add .
git commit -m "Family dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env.local` is gitignored, so your config stays local; `.env.example` is
committed as the template. The publishable key is designed to ship to browsers,
so it is not a secret — but it is still the front door to this data (see
[Security model](#security-model)), and it can be rotated independently in
**Supabase → Project Settings → API Keys**.

---

## Deploy to Cloudflare Pages

`next build` emits a fully static site to `out/`, so Pages serves it with no
Workers runtime involved.

### Option A — connect the repo (recommended)

Pages then rebuilds on every push to `main`.

1. **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. Pick this repository.
3. Build settings:
   - **Framework preset:** Next.js (Static HTML Export)
   - **Build command:** `npm run build`
   - **Build output directory:** `out`
4. **Environment variables** — add both, for *Production* **and** *Preview*:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   They must exist before the first build, because they are compiled in.
5. **Save and Deploy.**

### Option B — deploy from your machine

```bash
npx wrangler login
npm run deploy
```

`wrangler.toml` already points Pages at `out/`.

### After the first deploy

Add your Pages URL to **Supabase → Authentication → URL Configuration → Site URL
/ Redirect URLs**. Not required today (there is no auth), but it is the thing
you will forget when you add it later.

---

## Security model

The spec calls for profile *selection*, not login — so the browser only ever
carries the Supabase **publishable** key, and the RLS policies grant the `anon`
role read/write on the nine `family_*` tables.

**In practice: anyone with the site URL and that key can read and write this
family's data** — and that now includes family photos, uploaded files and voice
recordings. The storage bucket is private and served through signed URLs, which
stops the objects being enumerable, but it does not stop someone holding the key
from asking for a signed URL themselves.

It also bounds what "delete your own messages" can mean. The client sends
`.eq("sender_id", me)`, and `me` is whichever profile the device picked — so
the rule is honest about *accidents*, not about *adversaries*. Anyone holding
the key can issue whatever update they like. Making that a real guarantee needs
auth plus an RLS predicate such as
`using (sender_id = auth.uid())` on `family_messages`, and the equivalent on
`family_message_reactions`.

That trade was fine for a chore list. With photos and voice notes in it, adding
a login is the sensible next step, and doubly so if the site or the repository
is public.

RLS is still enabled with explicit, table-scoped policies, so the blast radius
stops at `family_*` — the other apps in this database are untouched.

To lock it down later:

1. Turn on an auth provider in Supabase (email magic links are enough).
2. Add `user_id uuid references auth.users` to `family_members`.
3. Replace `using (true) with check (true)` in the migration's policy loop with a
   real predicate, e.g. `auth.uid() is not null`.
4. Wrap the app in a sign-in gate and map the signed-in user to their member row.

Nothing else in the app has to change — the data layer is already keyed on
`family_members.id`.

---

## Project structure

```
src/
  app/
    layout.tsx            root layout, fonts, theme colour
    page.tsx              renders <App/>
    globals.css           Tailwind v4 theme tokens
  components/
    App.tsx               config check → setup → profile gate → shell
    FamilyProvider.tsx    members + "who am I" (localStorage), React context
    SetupScreen.tsx       first-run: name the household
    ProfileGate.tsx       "Who's using this?"
    Shell.tsx             header, desktop tabs, mobile bottom bar
    ThemeProvider.tsx     light/dark/system preference, persisted
    ThemeToggle.tsx       the 🌙/☀️ header button
    CalendarTab.tsx       upcoming agenda + per-person tabs
    EventsTab.tsx
    ChatTab.tsx           bubbles, attachments, reactions, delete
    CalendarFeeds.tsx     subscribe/import iCal feeds
    TodayCard.tsx         quote + next event + "looking forward to"
    ui.tsx                Avatar, Button, Card, Modal, Field, EmptyState…
  hooks/
    useMessages.ts        history + Realtime + attachment lifecycle
    useReactions.ts       reaction rows + Realtime + optimistic toggle
    useEvents.ts          events + RSVPs
    useCalendarEntries.ts
    useCalendarFeeds.ts   feed CRUD + useCalendarAutoSync polling
  lib/
    supabase.ts           lazily-created client, config guard
    types.ts              row types, REACTION_EMOJI, the AgendaItem union
    dates.ts              local-time helpers (Monday-first, ISO weeks)
    palette.ts            member colours, categories, tint()
    storage.ts            upload / sign / remove in the private bucket
supabase/
  migrations/
    0001_family_dashboard.sql
    0002_media_quotes_ical.sql
    0003_reactions_and_chores_removal.sql
  functions/family-sync-ical/
```

### Notes on a couple of decisions

- **Dates are handled in local time throughout.** `dayKey()` formats with
  `date-fns`, never `toISOString()`, which would shift the day for anyone west
  of UTC and land an event on the wrong date.
- **Signed URLs are re-signed on a timer.** They last 8 hours, and this thing
  runs on a tablet nobody reloads, so `useMessages` re-signs every attachment
  it is holding every 7 hours. Without that, images 403 partway through the
  day.
- **The calendar filter is single-select.** An earlier version toggled member
  visibility with a multi-select legend; "show me *my* week" is the question
  people actually ask, and one active tab answers it without any intermediate
  state to reason about. An unclaimed *event* still shows on every tab, since
  a family outing nobody has RSVP'd to is not nobody's business.
- **Weeks start Monday** (`startOfWeekMon`, ISO weeks) wherever a week boundary
  is needed.
