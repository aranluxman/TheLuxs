-- ============================================================================
--  Family Dashboard — the chore board
--
--  Chores are back, but not the machinery that was dropped in 0004. That
--  version had a rotation engine in SQL: `family_chore_templates` defined a
--  recurrence, `family_generate_chores()` materialised an instance row per
--  chore per period, and `family_chore_exclusions` patched the roster when
--  somebody was away. It was a scheduler, and nobody wanted a scheduler.
--
--  What the house actually wanted is the list off the fridge, with a tick box.
--  So the roster now lives in the app (`src/lib/chores.ts`) — it changes about
--  once a year, by conversation — and the only thing here is the tick:
--
--      "chore X was done for period P, by member M, at time T"
--
--  That inversion is what makes this table trivial. There are no rows to
--  generate ahead of time, nothing to backfill when the roster changes, and no
--  period a chore can be missing from: an absent row *is* "not done yet".
--
--  `period_key` is a local day for a daily chore (`2026-08-24`) and an ISO
--  week for a weekly one (`2026-W35`). It is computed on the client, because
--  the client is the only party that knows the household's timezone — the
--  server would file a Sunday-evening sweep under Monday for anyone west of
--  UTC. The check constraint accepts exactly those two shapes and nothing else.
--
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.family_chore_ticks (
  -- Matches a `key` in `src/lib/chores.ts`. Deliberately not a foreign key:
  -- the roster is code, and a chore that is retired should leave its history
  -- behind rather than take it away.
  chore_key  text not null check (chore_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
  period_key text not null check (period_key ~ '^\d{4}-(\d{2}-\d{2}|W\d{2})$'),
  done_by    uuid references public.family_members(id) on delete set null,
  done_at    timestamptz not null default now(),

  -- One tick per chore per period. Two people finishing the vacuuming at once
  -- is a race the primary key settles rather than a duplicate on the board;
  -- the app inserts with `on conflict do nothing` and re-reads.
  primary key (chore_key, period_key)
);

-- The board only ever asks for one or two periods at a time — today, and this
-- week. Leading on `period_key` is exactly that query.
create index if not exists family_chore_ticks_period_idx
  on public.family_chore_ticks (period_key);

-- "What has Sahana done lately" — the per-person filter on the board.
create index if not exists family_chore_ticks_member_idx
  on public.family_chore_ticks (done_by, done_at desc);

-- ---------------------------------------------------------------------------
-- RLS, in the per-command shape 0005 established.
-- ---------------------------------------------------------------------------
alter table public.family_chore_ticks enable row level security;

drop policy if exists family_chore_ticks_read on public.family_chore_ticks;
create policy family_chore_ticks_read on public.family_chore_ticks
  for select to anon, authenticated using (true);

drop policy if exists family_chore_ticks_add on public.family_chore_ticks;
create policy family_chore_ticks_add on public.family_chore_ticks
  for insert to anon, authenticated with check (true);

-- Unticking is how you undo a misfire, and on a shared board anyone may undo
-- anyone's — the alternative is chasing whoever is out of the house.
drop policy if exists family_chore_ticks_remove on public.family_chore_ticks;
create policy family_chore_ticks_remove on public.family_chore_ticks
  for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime. The board is read on a wall tablet and ticked on a phone; without
-- this the tablet keeps showing the bins as outstanding all evening.
--
-- FULL replica identity so an untick's DELETE payload carries the row and
-- other devices know which card to reopen.
-- ---------------------------------------------------------------------------
alter table public.family_chore_ticks replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_chore_ticks;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Grants, in the doctrine 0005 set out: policies express intent, grants are
-- what Postgres actually enforces, so anything the app never does is revoked
-- rather than merely un-policied.
--
-- TRUNCATE is the sharp one. Supabase's default `grant all` hands it to
-- `anon`, and TRUNCATE ignores row-level security completely — so a policy
-- that carefully allows removing one tick at a time is no obstacle at all to
-- one statement that empties the board. The anon key ships inside a static
-- site, so it is not a secret.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on public.family_chore_ticks
  from anon, authenticated;

-- There is no UPDATE in this feature at all. A tick is inserted or deleted;
-- "someone else actually did it" is an untick and a re-tick, which keeps
-- `done_at` honest instead of letting a row claim a time it was not set at.
revoke update on public.family_chore_ticks from anon, authenticated;
