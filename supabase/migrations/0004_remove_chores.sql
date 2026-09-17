-- ============================================================================
--  Family Dashboard, round 4 — remove the chores feature.
--
--  DESTRUCTIVE, and deliberately not bundled with round 3. The app stopped
--  shipping a Chores tab in "Redesign chat and calendar, remove chores", so
--  nothing reads these tables any more — but they still hold real history, and
--  dropping them cannot be undone. Run this only when you have decided that
--  history is expendable (or have taken a backup).
--
--  Round 3 does not depend on this file. The chat works fully without it.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- Dropped in dependency order. `family_chores` references the templates, and
-- both reference the recurrence enum, so the enum goes last. Nothing outside
-- the chores feature ever used any of it.
-- Functions first, and `family_set_chore_done` specifically before the tables:
-- it is declared `returns public.family_chores`, so it holds a dependency on
-- the table's composite type and the DROP TABLE below fails while it exists.
drop function if exists public.family_regenerate_future_chores(date, integer);
drop function if exists public.family_generate_chores(date, integer);
drop function if exists public.family_set_chore_done(uuid, boolean, uuid);

-- Drop from the realtime publication first — dropping a published table while
-- it is still a member leaves the publication in an awkward state on older
-- Postgres versions.
do $$
begin
  alter publication supabase_realtime drop table public.family_chores;
exception when undefined_object or undefined_table then null; end $$;

drop table if exists public.family_chore_exclusions;
drop table if exists public.family_chores;
drop table if exists public.family_chore_templates;

drop type if exists public.family_recurrence;
