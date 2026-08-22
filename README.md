# Family Dashboard

Chores, events, a shared calendar and a group chat for a five-person household —
one page, four tabs, live on every device in the house.

Built with **Next.js 16 (App Router, TypeScript)**, **Tailwind CSS v4**,
**Supabase** (Postgres + Realtime) and deployed as a **static site on Cloudflare Pages**.

---

## What each tab does

| Tab | What it does |
| --- | --- |
| **Chores** | Today's daily jobs and this week's deep clean, filtered to *Mine* or *Everyone*. Tick a box and it lands on every other device instantly. A "Coming up" strip shows the next six days of the rotation. |
| **Events** | The family activity board — movie night, the CNE, a trip downtown. Title, date/time, location, notes, and a per-person RSVP checklist (Going / Maybe / Can't). |
| **Calendar** | One grid that overlays *everything*: posted events, each person's schedule entries, and chore deadlines. Month and week views, colour-coded per member, with the legend doubling as a filter. |
| **Chat** | An iMessage-style group thread — grouped bubbles, day separators, timestamps, sender colours, and live delivery over Supabase Realtime. Photos, files and voice notes attach to messages; anyone can delete a message. |

Every screen also carries a **profile photo** per person, and the Chores tab
opens with a quote of the day, the next thing on the family's calendar, and
what each person says they're looking forward to.

There is no login. You pick your face once and the device remembers you — see
[Security model](#security-model) for what that means and how to tighten it.

---

## How the chore rotation works

This is the one piece worth understanding before you change anything.

Chores live in **two** tables:

- `family_chore_templates` — the *definition* ("Wash the dishes", daily).
- `family_chores` — one *instance* per (chore, period), with an assignee, a due
  date and a completion flag.

Instances are materialised by `family_generate_chores(from_date, days)`. The
assignment is a pure function of the period number:

```
assignee = members[(period_index + template.rotation_offset) % member_count]
```

where `period_index` counts days (for daily chores) or ISO weeks (for weekly
ones) from a fixed Monday. Two consequences fall out of that:

- **It is idempotent.** `UNIQUE (template_id, period_key)` means re-running
  never duplicates or reshuffles anything, so every device can safely call it on
  load — the first one writes, the rest no-op.
- **It is deterministic.** Every client computes the same roster, and history
  never rewrites itself.

`rotation_offset` staggers the starting person per chore, so nobody draws every
job on day one. The app keeps four weeks materialised ahead of today.

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

**Deleting:** anyone can delete any message — it becomes a tombstone reading
"Message deleted by …", and the attachment reference is cleared. Keeping the
row means the conversation keeps its shape and the history stays complete.
Note the storage object itself is left in the bucket; see *Housekeeping* below.

### Who does which chore

**Chores → Who does what** lets you excuse anyone from a specific job. The
rotation then skips them entirely, and the remaining people share it evenly —
it does not simply leave a gap on their turn. Changing this rewrites only the
chores nobody has ticked off yet; completed ones are the household's record and
are never touched.

### Combining everyone's calendars

**Calendar → Feeds** subscribes each person's calendar so they all overlay on
one grid, colour-coded by whose it is. Two ways in:

- **A live link** — Google Calendar → *Settings* → *Integrate calendar* →
  *Secret address in iCal format*. Apple and Outlook publish a similar URL.
  `webcal://` works. These re-sync on demand via *Sync*.
- **A pasted `.ics` file** — a one-off import that doesn't refresh by itself.

Fetching and parsing happen in the `family-sync-ical` Edge Function, not the
browser, for two reasons: calendar providers almost never send CORS headers, so
a browser can't read those URLs; and expanding a repeating event needs a real
RRULE implementation (it uses `ical.js`). Occurrences are expanded across a
window of 30 days back to 12 months ahead, and each sync replaces that window
wholesale so upstream cancellations disappear too.

Imported entries are read-only in the app — deleting one locally would just
bring it back on the next sync. Remove the feed instead, which takes its events
with it.

To deploy the function after changing it:

```bash
npx supabase functions deploy family-sync-ical --project-ref <your-ref>
```

### Housekeeping

Two things are deliberately left for you rather than automated:

- Deleting a message clears its attachment reference but leaves the file in the
  bucket. A scheduled job could sweep orphans; for a five-person household it's
  cheaper to ignore.
- Feed syncs are manual. If you want them automatic, `pg_cron` plus `pg_net`
  (already installed) can POST to the Edge Function on a schedule.

## Setup

### 1. Database

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql) and
run [`supabase/migrations/0001_family_dashboard.sql`](supabase/migrations/0001_family_dashboard.sql).

Then run `supabase/migrations/0002_media_quotes_ical.sql`, which adds profile
photos, chat attachments, chore exclusions, quotes and calendar feeds.

Both are idempotent — safe to re-run. Together they create:

- `family_members`, `family_chore_templates`, `family_chores`,
  `family_events`, `family_event_rsvps`, `family_calendar_entries`,
  `family_messages`
- the `family_generate_chores()` rotation engine and `family_set_chore_done()`
- RLS policies on all seven tables
- Realtime on `family_messages` and `family_chores`
- six starter chores (counters, dishes, putting away dishes, trash, vacuuming, mopping)
- `family_chore_exclusions`, `family_quotes`, `family_looking_forward`,
  `family_calendar_feeds`
- the private `family-media` storage bucket and its policy
- 28 seeded quotes

> **Table naming.** Every object is prefixed `family_` because this Supabase
> project is shared with other apps that follow the same convention
> (`life_flow_*`, `myday_*`, `alux_*`). Nothing here touches those tables.

No family members are seeded — the app's first-run screen creates them, which is
also what establishes the rotation order.

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
role read/write on the seven `family_*` tables.

**In practice: anyone with the site URL and that key can read and write this
family's data** — and that now includes family photos, uploaded files and voice
recordings. The storage bucket is private and served through signed URLs, which
stops the objects being enumerable, but it does not stop someone holding the key
from asking for a signed URL themselves.

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
    ChoresTab.tsx
    EventsTab.tsx
    CalendarTab.tsx       aggregates events + entries + chore deadlines
    ChatTab.tsx
    ui.tsx                Avatar, Button, Card, Modal, Field, EmptyState…
  hooks/
    useChores.ts          range query + Realtime + optimistic toggle
    useMessages.ts        history + Realtime inserts/deletes
    useEvents.ts          events + RSVPs
    useCalendarEntries.ts
  lib/
    supabase.ts           lazily-created client, config guard
    types.ts              row types + the AgendaItem union
    dates.ts              local-time helpers (Monday-first, ISO weeks)
    palette.ts            member colours, categories, tint()
supabase/
  migrations/0001_family_dashboard.sql
```

### Notes on a couple of decisions

- **Dates are handled in local time throughout.** `dayKey()` formats with
  `date-fns`, never `toISOString()`, which would shift the day for anyone west
  of UTC and put chores on the wrong date.
- **Chore toggles are optimistic** and roll back if the write fails. The
  Realtime handler ignores rows outside the window currently on screen.
- **Weeks start Monday** in the UI because the SQL rotation uses ISO weeks.
  Change one and you must change the other.
