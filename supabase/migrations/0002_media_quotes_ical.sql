-- ============================================================================
--  Family Dashboard, round 2
--    • profile photos
--    • chat attachments, voice notes, soft delete
--    • per-chore exclusions (rotation skips people who don't do that job)
--    • motivational quotes + "looking forward to"
--    • iCal feed subscriptions
--  Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage. One private bucket for everything the family uploads. Private
-- because it holds photos of the household and voice recordings; the app hands
-- out short-lived signed URLs instead of permanent public links.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('family-media', 'family-media', false, 26214400)  -- 25 MB
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists family_media_access on storage.objects;
create policy family_media_access on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'family-media')
  with check (bucket_id = 'family-media');

-- ---------------------------------------------------------------------------
-- Profile photos
-- ---------------------------------------------------------------------------
alter table public.family_members
  add column if not exists avatar_path text;

-- ---------------------------------------------------------------------------
-- Chat: attachments + soft delete
--
-- Deletion is a tombstone rather than a hard DELETE: it satisfies "let us
-- remove a message" while keeping the thread's shape intact, and it is the
-- behaviour people already expect from every other messenger.
-- ---------------------------------------------------------------------------
alter table public.family_messages
  add column if not exists attachment_path     text,
  add column if not exists attachment_kind     text,   -- 'image' | 'voice' | 'file'
  add column if not exists attachment_name     text,
  add column if not exists attachment_mime     text,
  add column if not exists attachment_size     integer,
  add column if not exists attachment_duration real,   -- seconds, voice notes only
  add column if not exists deleted_at          timestamptz,
  add column if not exists deleted_by          uuid references public.family_members(id) on delete set null;

do $$ begin
  alter table public.family_messages
    add constraint family_messages_attachment_kind_check
    check (attachment_kind is null or attachment_kind in ('image', 'voice', 'file'));
exception when duplicate_object then null; end $$;

-- The original check demanded non-empty text. A voice note has no text, so the
-- rule becomes "a message must carry either words or a file".
alter table public.family_messages drop constraint if exists family_messages_message_text_check;

-- A deleted message legitimately has neither, so tombstones are exempt.
alter table public.family_messages drop constraint if exists family_messages_has_content_check;

alter table public.family_messages
  add constraint family_messages_has_content_check
  check (
    length(message_text) <= 2000
    and (
      deleted_at is not null
      or length(trim(message_text)) > 0
      or attachment_path is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Chore exclusions — "don't put Sukhi on mopping or vacuuming".
-- The rotation skips excluded people entirely rather than assigning and
-- reassigning, so the remaining members share the job evenly.
-- ---------------------------------------------------------------------------
create table if not exists public.family_chore_exclusions (
  template_id uuid not null references public.family_chore_templates(id) on delete cascade,
  member_id   uuid not null references public.family_members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (template_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Motivational quotes, shown one per day (deterministically, so everyone in
-- the house sees the same one).
-- ---------------------------------------------------------------------------
create table if not exists public.family_quotes (
  id         uuid primary key default gen_random_uuid(),
  quote_text text not null,
  author     text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- One thing each person is looking forward to.
-- ---------------------------------------------------------------------------
create table if not exists public.family_looking_forward (
  member_id   uuid primary key references public.family_members(id) on delete cascade,
  note        text not null check (length(trim(note)) between 1 and 160),
  target_date date,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- iCal feeds. Entries imported from a feed are owned by it, identified by the
-- event's iCalendar UID so a re-sync updates in place instead of duplicating.
-- ---------------------------------------------------------------------------
create table if not exists public.family_calendar_feeds (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid references public.family_members(id) on delete cascade,
  name           text not null,
  url            text not null,
  is_active      boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  last_event_count integer,
  created_at     timestamptz not null default now()
);

alter table public.family_calendar_entries
  add column if not exists source_feed_id uuid references public.family_calendar_feeds(id) on delete cascade,
  add column if not exists source_uid     text,
  add column if not exists all_day        boolean not null default false;

-- A feed's event is unique by (feed, UID, start) — the start disambiguates the
-- instances of a recurring event, which all share one UID.
create unique index if not exists family_calendar_source_idx
  on public.family_calendar_entries (source_feed_id, source_uid, start_time)
  where source_feed_id is not null;

-- ---------------------------------------------------------------------------
-- Rotation, now exclusion-aware.
-- Templates are the outer loop so the eligible roster is computed once each.
-- ---------------------------------------------------------------------------
create or replace function public.family_generate_chores(
  p_from date default current_date,
  p_days integer default 14
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_eligible  uuid[];
  v_count     integer;
  v_day       date;
  v_tpl       record;
  v_period    text;
  v_due       date;
  v_index     bigint;
  v_week_mon  date;
  v_inserted  integer := 0;
begin
  for v_tpl in
    select * from public.family_chore_templates where is_active order by sort_order, id
  loop
    select array_agg(m.id order by m.sort_order, m.created_at, m.id)
      into v_eligible
      from public.family_members m
     where not exists (
       select 1 from public.family_chore_exclusions x
        where x.template_id = v_tpl.id and x.member_id = m.id
     );

    v_count := coalesce(array_length(v_eligible, 1), 0);
    if v_count = 0 then
      continue;  -- everybody is excused from this one
    end if;

    for v_day in
      select generate_series(p_from, p_from + (greatest(p_days, 1) - 1), interval '1 day')::date
    loop
      if v_tpl.recurrence_type = 'daily' then
        v_due    := v_day;
        v_period := 'd:' || to_char(v_day, 'YYYY-MM-DD');
        v_index  := v_day - date '1970-01-05';
      else
        v_week_mon := date_trunc('week', v_day)::date;
        v_due      := v_week_mon + 6;
        v_period   := 'w:' || to_char(v_week_mon, 'IYYY-"W"IW');
        v_index    := (v_week_mon - date '1970-01-05') / 7;
      end if;

      insert into public.family_chores (
        template_id, title, description, recurrence_type,
        assigned_member_id, due_date, period_key
      )
      values (
        v_tpl.id, v_tpl.title, v_tpl.description, v_tpl.recurrence_type,
        v_eligible[ ((v_index + v_tpl.rotation_offset) % v_count) + 1 ],
        v_due, v_period
      )
      on conflict (template_id, period_key) do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end loop;

  return v_inserted;
end;
$fn$;

-- Changing who is excused only affects chores that have not been handed out
-- yet, so clear the untouched future ones and lay them down again. Completed
-- chores are never removed — that is the household's record of who did what.
create or replace function public.family_regenerate_future_chores(
  p_from date default current_date,
  p_days integer default 28
)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  delete from public.family_chores
   where is_completed = false
     and due_date >= p_from;

  return public.family_generate_chores(p_from, p_days);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------
alter table public.family_chore_exclusions enable row level security;
alter table public.family_quotes           enable row level security;
alter table public.family_looking_forward  enable row level security;
alter table public.family_calendar_feeds   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'family_chore_exclusions', 'family_quotes',
    'family_looking_forward', 'family_calendar_feeds'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_family_access', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_family_access', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed quotes
-- ---------------------------------------------------------------------------
insert into public.family_quotes (quote_text, author)
select v.q, v.a
from (values
  ('The best time to plant a tree was twenty years ago. The second best time is now.', 'Proverb'),
  ('It does not matter how slowly you go as long as you do not stop.', 'Confucius'),
  ('We are what we repeatedly do. Excellence, then, is not an act but a habit.', 'Will Durant'),
  ('Fall seven times, stand up eight.', 'Japanese proverb'),
  ('He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'),
  ('The journey of a thousand miles begins with a single step.', 'Lao Tzu'),
  ('Little by little, one travels far.', 'Proverb'),
  ('Do what you can, with what you have, where you are.', 'Theodore Roosevelt'),
  ('A ship in harbour is safe, but that is not what ships are built for.', 'John A. Shedd'),
  ('The obstacle is the way.', 'Marcus Aurelius'),
  ('Well begun is half done.', 'Aristotle'),
  ('Rivers know this: there is no hurry. We shall get there some day.', 'A. A. Milne'),
  ('What we think, we become.', 'Buddha'),
  ('Energy and persistence conquer all things.', 'Benjamin Franklin'),
  ('The secret of getting ahead is getting started.', 'Mark Twain'),
  ('You miss one hundred percent of the shots you do not take.', 'Wayne Gretzky'),
  ('Alone we can do so little; together we can do so much.', 'Helen Keller'),
  ('Kind words can be short and easy to speak, but their echoes are truly endless.', 'Mother Teresa'),
  ('A person who never made a mistake never tried anything new.', 'Albert Einstein'),
  ('The family is one of nature''s masterpieces.', 'George Santayana'),
  ('Happiness is only real when shared.', 'Christopher McCandless'),
  ('Patience is bitter, but its fruit is sweet.', 'Aristotle'),
  ('Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'),
  ('However difficult life may seem, there is always something you can do and succeed at.', 'Stephen Hawking'),
  ('Nothing is particularly hard if you divide it into small jobs.', 'Henry Ford'),
  ('The good life is a process, not a state of being.', 'Carl Rogers'),
  ('Be curious, not judgmental.', 'Walt Whitman'),
  ('Enjoy the little things, for one day you may look back and realise they were the big things.', 'Robert Brault')
) as v(q, a)
where not exists (select 1 from public.family_quotes existing where existing.quote_text = v.q);
