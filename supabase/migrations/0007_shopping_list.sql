-- ============================================================================
--  Family Dashboard — the shopping list
--
--  One shared list rather than a list per person: the household walks around
--  Costco together, and "who added the milk" is a detail, not a filter. Who
--  added an item and who ticked it are both recorded, because on a shared list
--  the interesting question is usually "did someone already get this?".
--
--  Ticking an item does not delete it. `completed_at` is the whole state
--  machine: null means still to buy, set means done, and unticking clears it
--  again. That keeps the completed section a real record of the trip rather
--  than a thing that evaporates, and makes "undo" free.
--
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.family_shopping_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 120),
  -- Free text rather than a number: "2 boxes", "the big one", "any brand" are
  -- all things people actually write on a Costco list.
  note         text check (note is null or length(note) <= 80),
  added_by     uuid references public.family_members(id) on delete set null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.family_members(id) on delete set null,

  -- A completed item must say who completed it, and an open one must not
  -- claim to have been. Without this the two columns can drift apart and the
  -- UI has to guess which one to believe.
  constraint family_shopping_completion_consistent
    check ((completed_at is null) = (completed_by is null))
);

-- The list is read as two buckets, each in its own order: open items oldest
-- first, done items most-recently-ticked first. One index serves both.
create index if not exists family_shopping_open_idx
  on public.family_shopping_items (completed_at, created_at);

-- ---------------------------------------------------------------------------
-- RLS, in the per-command shape 0005 established.
-- ---------------------------------------------------------------------------
alter table public.family_shopping_items enable row level security;

drop policy if exists family_shopping_items_read on public.family_shopping_items;
create policy family_shopping_items_read on public.family_shopping_items
  for select to anon, authenticated using (true);

drop policy if exists family_shopping_items_add on public.family_shopping_items;
create policy family_shopping_items_add on public.family_shopping_items
  for insert to anon, authenticated
  with check (
    length(trim(name)) between 1 and 120
    -- Nothing may be born completed; ticking is an update, which is where the
    -- completed_by column gets filled in.
    and completed_at is null
    and completed_by is null
  );

drop policy if exists family_shopping_items_tick on public.family_shopping_items;
create policy family_shopping_items_tick on public.family_shopping_items
  for update to anon, authenticated using (true) with check (true);

-- Removing something you added by mistake is ordinary use, so unlike messages
-- this table allows a real delete. There is no history worth keeping in a
-- shopping list once the trip is over.
drop policy if exists family_shopping_items_remove on public.family_shopping_items;
create policy family_shopping_items_remove on public.family_shopping_items
  for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime. This is the feature's whole point: one person ticks the milk in
-- aisle four and it greys out on everyone else's phone.
--
-- FULL replica identity so a DELETE payload carries the removed row and other
-- devices know which item vanished.
-- ---------------------------------------------------------------------------
alter table public.family_shopping_items replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_shopping_items;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Grants, in the doctrine 0005 set out: policies express intent, grants are
-- what Postgres actually enforces, so anything the app never does is revoked
-- rather than merely un-policied.
--
-- TRUNCATE is the sharp one. Supabase's default `grant all` hands it to
-- `anon`, and TRUNCATE ignores row-level security completely — so a policy
-- that carefully allows deleting one row at a time is no obstacle at all to
-- one statement that empties the table. The anon key ships inside a static
-- site, so it is not a secret.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on public.family_shopping_items
  from anon, authenticated;

-- Ticking is the only update the app performs. Without this, an update is
-- free to rewrite `name` or reassign `added_by` on someone else's item, or
-- backdate `created_at` to sort itself to the top of the list.
revoke update on public.family_shopping_items from anon, authenticated;
grant update (completed_at, completed_by) on public.family_shopping_items
  to anon, authenticated;
