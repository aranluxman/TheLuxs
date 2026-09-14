-- ============================================================================
--  Family Dashboard — To Do's, second pass
--
--  Three changes, all of them asked for by the house after living with 0014:
--
--  1. A task can be shared with *several* people. 0014 had one `assigned_to`,
--     which forced "Aran and Sahana tidy the garage" to be typed twice and
--     then ticked twice. The column becomes `assignee_ids uuid[]`, and the
--     empty array keeps the meaning the null used to have: everyone.
--
--     An array rather than a junction table on purpose. A junction row would
--     be the textbook shape, and it would also mean a second query, a second
--     realtime subscription and a join on every read of a board that never
--     holds more than a few dozen rows. The array is denormalised and it is
--     the whole feature in one column that Realtime already carries.
--
--     No foreign key is possible on an array element, so a removed member
--     leaves their id behind. The client resolves ids through the member map
--     and drops the ones it cannot find, exactly as it already does for a
--     chore tick whose owner is gone.
--
--  2. `estimate_minutes` — how long the job is expected to take. Minutes, not
--     a free-text "about an hour", so the board can add them up and say what
--     the evening actually costs.
--
--  3. Visibility. A task naming specific people is theirs and their author's;
--     it is not everyone's business. Like the direct messages in 0006 this is
--     a *client-side* filter, not a security boundary — there is no login, so
--     the SELECT policy stays `using (true)` and every browser is still sent
--     every row. See the README's Security model before treating it as more
--     than the courtesy it is.
--
--  Idempotent: safe to re-run.
-- ============================================================================

alter table public.family_todos
  add column if not exists assignee_ids uuid[] not null default '{}',
  add column if not exists estimate_minutes int;

-- Backfill from the single-assignee column before it goes away, so no task
-- loses the name that was on it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'family_todos'
      and column_name = 'assigned_to'
  ) then
    update public.family_todos
       set assignee_ids = array[assigned_to]
     where assigned_to is not null
       and assignee_ids = '{}';

    alter table public.family_todos drop column assigned_to;
  end if;
end $$;

-- A guard rather than a preference: an unbounded integer here would let one
-- task claim a year of the week's capacity and make every total meaningless.
-- Seven days in minutes is the ceiling; anything longer is a project, not a
-- task.
alter table public.family_todos
  drop constraint if exists family_todos_estimate_sane;
alter table public.family_todos
  add constraint family_todos_estimate_sane
  check (estimate_minutes is null or estimate_minutes between 1 and 10080);

-- Five people in this house; a task naming more than a dozen is a typo or a
-- paste. Also keeps the row small enough that Realtime never has to think.
alter table public.family_todos
  drop constraint if exists family_todos_assignees_sane;
alter table public.family_todos
  add constraint family_todos_assignees_sane
  check (array_length(assignee_ids, 1) is null or array_length(assignee_ids, 1) <= 12);

comment on column public.family_todos.assignee_ids is
  'Who the task is for. Empty means the whole house. Only these people and created_by see it in the UI — a courtesy filter, not a security boundary.';
comment on column public.family_todos.estimate_minutes is
  'How long the job is expected to take, in minutes. Null means nobody said.';

-- "What is on my plate" — the read the board does on every visit now that a
-- task can name several people.
create index if not exists family_todos_assignees_idx
  on public.family_todos using gin (assignee_ids);

-- ---------------------------------------------------------------------------
-- Policies. The insert check has to learn the new columns; the rest of the
-- shape is 0014's and unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists family_todos_add on public.family_todos;
create policy family_todos_add on public.family_todos
  for insert to anon, authenticated
  with check (
    length(trim(title)) between 1 and 140
    and done_at is null
    and done_by is null
    and (estimate_minutes is null or estimate_minutes between 1 and 10080)
  );

-- ---------------------------------------------------------------------------
-- Grants. 0014 revoked UPDATE wholesale and granted it back column by column,
-- and that list is the *only* thing standing between the anon key and a
-- rewritten board — so editing a task means naming `title` here explicitly.
--
-- `created_at` and `created_by` stay off the list. Who wrote a task and when
-- is the one part of a row nobody gets to edit after the fact; it is also what
-- the visibility filter leans on, so a writable `created_by` would be a way to
-- hand yourself someone else's private task.
-- ---------------------------------------------------------------------------
revoke update on public.family_todos from anon, authenticated;
grant update (done_at, done_by, assignee_ids, due_on, title, estimate_minutes)
  on public.family_todos to anon, authenticated;

notify pgrst, 'reload schema';
