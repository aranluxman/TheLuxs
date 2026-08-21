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
| **Chat** | An iMessage-style group thread — grouped bubbles, day separators, timestamps, sender colours, and live delivery over Supabase Realtime. |

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

## Setup

### 1. Database

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql) and
run [`supabase/migrations/0001_family_dashboard.sql`](supabase/migrations/0001_family_dashboard.sql).

It is idempotent — safe to re-run. It creates:

- `family_members`, `family_chore_templates`, `family_chores`,
  `family_events`, `family_event_rsvps`, `family_calendar_entries`,
  `family_messages`
- the `family_generate_chores()` rotation engine and `family_set_chore_done()`
- RLS policies on all seven tables
- Realtime on `family_messages` and `family_chores`
- six starter chores (counters, dishes, putting away dishes, trash, vacuuming, mopping)

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
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Both are in **Project Settings → Data API / API Keys**.

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

`.env.local` is gitignored, so your keys stay local; `.env.example` is committed
as the template. If you ever do commit a key by accident, rotate it in
**Supabase → Project Settings → API Keys** rather than just deleting the file.

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
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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
carries the Supabase **anon** key, and the RLS policies grant the `anon` role
read/write on the seven `family_*` tables.

**In practice: anyone with the site URL and the anon key can read and write this
family's data.** That is an acceptable trade for a household dashboard on a home
network; it is not acceptable if you put the URL somewhere public.

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
