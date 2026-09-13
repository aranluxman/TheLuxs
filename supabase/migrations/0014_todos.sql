-- ============================================================================
--  Family Dashboard — the To Do's board
--
--  The chore board answers "what needs doing around the house, every week".
--  This answers the other half: one-off jobs, with a name on them and a day
--  they need to be done by. "Book the dentist", "return the library books".
--
--  Assignment is a single member or nobody:
--
--    assigned_to = <member>   that person's job
--    assigned_to is null      Everyone's — the same shape the group chat uses
--                             for `recipient_id`, and for the same reason: the
--                             unassigned case is the common one, and giving it
--                             a sentinel row would mean every read joining
--                             against a fake member.
--
--  Ticking does not delete. `done_at` is the whole state machine, exactly as
--  `completed_at` is on the shopping list — so unticking is free and a
--  finished list is a record of the week rather than an empty screen.
--
--  `due_on` is a `date`, not a timestamp. A task is due on a day, not at an
--  instant; storing it as a timestamp would push it across midnight for anyone
--  in a different timezone and make "is this overdue" a question about clocks
--  rather than about calendars.
--
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.family_todos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) between 1 and 140),
  -- Null means the whole house. See the header.
  assigned_to uuid references public.family_members(id) on delete set null,
  due_on      date,
  created_by  uuid references public.family_members(id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  done_by     uuid references public.family_members(id) on delete set null,

  -- A done task must say who finished it, and an open one must not claim to
  -- have been finished. Without this the two columns drift and the UI has to
  -- guess which one to believe.
  constraint family_todos_done_consistent
    check ((done_at is null) = (done_by is null))
);

comment on table public.family_todos is
  'One-off family tasks. assigned_to null means everyone. Ticking sets done_at/done_by rather than deleting.';

-- The board reads as two buckets: open tasks by due date (undated last), and
-- done tasks most recently finished first. One index covers the open read,
-- which is the one that happens on every visit.
create index if not exists family_todos_open_idx
  on public.family_todos (done_at, due_on nulls last, created_at);

-- ---------------------------------------------------------------------------
-- RLS, in the per-command shape 0005 established. As everywhere else in this
-- schema these constrain the *shape* of a write, never who is writing — there
-- is still no login. See 0005 PART 3.
-- ---------------------------------------------------------------------------
alter table public.family_todos enable row level security;

drop policy if exists family_todos_read on public.family_todos;
create policy family_todos_read on public.family_todos
  for select to anon, authenticated using (true);

drop policy if exists family_todos_add on public.family_todos;
create policy family_todos_add on public.family_todos
  for insert to anon, authenticated
  with check (
    length(trim(title)) between 1 and 140
    -- Nothing may be born done; ticking is an update, which is where done_by
    -- gets filled in.
    and done_at is null
    and done_by is null
  );

drop policy if exists family_todos_tick on public.family_todos;
create policy family_todos_tick on public.family_todos
  for update to anon, authenticated using (true) with check (true);

-- A task added by mistake is ordinary to remove, and unlike a message there is
-- no history here worth preserving once it is gone.
drop policy if exists family_todos_remove on public.family_todos;
create policy family_todos_remove on public.family_todos
  for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime: one person ticks a task and it greys out on everyone's phone,
-- which is the same reason the shopping list is published.
--
-- FULL replica identity so a DELETE payload carries the removed row and other
-- devices know which task vanished.
-- ---------------------------------------------------------------------------
alter table public.family_todos replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_todos;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Grants. Policies express intent; grants are what Postgres enforces, so
-- anything the app never does is revoked rather than merely un-policied.
--
-- TRUNCATE is the sharp one: Supabase's default `grant all` hands it to `anon`,
-- and TRUNCATE ignores row-level security entirely — so a policy that
-- carefully allows deleting one row at a time is no obstacle to one statement
-- that empties the table. The anon key ships inside a static site.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on public.family_todos
  from anon, authenticated;

-- Ticking and reassigning are the only updates the app performs. Without this
-- an update is free to rewrite someone else's task title, move its due date,
-- or backdate created_at to sort itself to the top of the board.
--
-- Note for whoever adds an upsert here later: this list must cover every
-- column the client sends, because PostgREST's upsert re-sets all of them on
-- the conflict path. That is exactly what broke the chore board in 0013.
revoke update on public.family_todos from anon, authenticated;
grant update (done_at, done_by, assigned_to, due_on) on public.family_todos
  to anon, authenticated;

-- PostgREST caches the column list; without this the first insert naming these
-- columns is rejected with PGRST204 on a schema that is already correct.
notify pgrst, 'reload schema';
