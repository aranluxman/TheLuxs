-- ============================================================================
--  Family Dashboard — chores: many hands, and chores worth more than one point
--
--  Two things the board got wrong, both of them the same shape: it assumed one
--  tick per chore per period, worth one point.
--
--  1. SOME CHORES ARE DONE BY SEVERAL PEOPLE, SEVERAL TIMES.
--
--     The dishes get washed after breakfast, after lunch and after dinner, and
--     not by the same person. 0008's primary key — (chore_key, period_key) —
--     made that impossible to record: the second person to tap their face
--     replaced the first, and took their point with them.
--
--     So the key becomes a surrogate `id`, with uniqueness on
--     (chore_key, period_key, done_by): one sign-up per person per chore per
--     period, and as many people as actually helped. Which chores allow more
--     than one name is a *product* decision that lives in `src/lib/chores.ts`
--     alongside the roster, not a constraint here — the database's job is to
--     make the record possible, and the app's is to decide what to offer.
--
--     `done_by` is nullable (a member can be deleted), and NULL is never equal
--     to NULL, so the unique index would not constrain orphaned rows at all.
--     `nulls not distinct` fixes exactly that.
--
--  2. NOT EVERY CHORE IS WORTH THE SAME.
--
--     Mopping the floors is not wiping the table. `points` is stamped on the
--     tick at the moment it happens rather than looked up from the roster when
--     the board renders — history is a record of what was earned, and re-scoring
--     last March because the roster was reworded in June would be a rewrite of
--     it.
--
--  Old rows carry over untouched: they keep their chore, their period, their
--  owner and their timestamp, and score the 1 point they were worth.
--
--  Idempotent: safe to re-run.
-- ============================================================================

alter table public.family_chore_ticks
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists points int not null default 1;

alter table public.family_chore_ticks
  drop constraint if exists family_chore_ticks_points_sane;
alter table public.family_chore_ticks
  add constraint family_chore_ticks_points_sane
  check (points between 1 and 10);

-- Swap the composite primary key for the surrogate one. Guarded on the current
-- shape so a re-run is a no-op rather than an error.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.family_chore_ticks'::regclass
       and contype = 'p'
       and conname = 'family_chore_ticks_pkey'
       and array_length(conkey, 1) = 2
  ) then
    alter table public.family_chore_ticks drop constraint family_chore_ticks_pkey;
    alter table public.family_chore_ticks add primary key (id);
  end if;
end $$;

-- One sign-up per person per chore per period. See the header for why NULLs
-- have to be treated as equal here.
create unique index if not exists family_chore_ticks_one_per_person_idx
  on public.family_chore_ticks (chore_key, period_key, done_by) nulls not distinct;

-- The history view reads "everything anyone did, newest first", over a window
-- much longer than the current week.
create index if not exists family_chore_ticks_recent_idx
  on public.family_chore_ticks (done_at desc);

comment on column public.family_chore_ticks.points is
  'What this chore was worth when it was done. Stamped at tick time so history is not re-scored when the roster changes.';

-- ---------------------------------------------------------------------------
-- The insert policy learns `points`; everything else keeps 0008's shape.
-- ---------------------------------------------------------------------------
drop policy if exists family_chore_ticks_add on public.family_chore_ticks;
create policy family_chore_ticks_add on public.family_chore_ticks
  for insert to anon, authenticated
  with check (points between 1 and 10);

-- ---------------------------------------------------------------------------
-- Grants. 0013 handed back UPDATE on (chore_key, period_key) for one reason
-- only: PostgREST's upsert re-sets every column in the payload, including the
-- conflict target. The board no longer upserts — a sign-up is an insert, a
-- withdrawal is a delete, and handing a single-signup chore to someone else is
-- an update of `done_by` by row id — so those two go back to being immutable,
-- which is what stops one statement moving a tick into a different week.
-- ---------------------------------------------------------------------------
revoke update on public.family_chore_ticks from anon, authenticated;
grant update (done_by, done_at) on public.family_chore_ticks
  to anon, authenticated;

notify pgrst, 'reload schema';
