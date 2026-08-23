-- ============================================================================
--  Family Dashboard, round 3
--    • message reactions (👍 ❤️ 😂) on the group chat
--    • chores removed entirely — tables, rotation engine and enum
--    • the indexes and constraints the first two rounds left out
--  Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reactions.
--
-- The primary key is (message, member, emoji) rather than (message, member):
-- one person may laugh at *and* heart the same message, and toggling one off
-- must not disturb the other. The emoji set is closed by a check constraint so
-- a stray client cannot widen it — the palette is a product decision, and the
-- UI renders exactly these three.
-- ---------------------------------------------------------------------------
create table if not exists public.family_message_reactions (
  message_id uuid not null references public.family_messages(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, member_id, emoji)
);

do $$ begin
  alter table public.family_message_reactions
    add constraint family_message_reactions_emoji_check
    check (emoji in ('👍', '❤️', '😂'));
exception when duplicate_object then null; end $$;

-- The chat loads reactions for one page of messages at a time, so the lookup
-- is always "every reaction whose message is in this set". The PK's leading
-- column already serves that; this one covers "what did I react to".
create index if not exists family_message_reactions_member_idx
  on public.family_message_reactions (member_id);

-- ---------------------------------------------------------------------------
-- Indexes the earlier rounds missed.
-- ---------------------------------------------------------------------------

-- Sender lookups: used when a member is removed and when auditing a thread.
create index if not exists family_messages_sender_idx
  on public.family_messages (sender_id);

-- The calendar now queries "upcoming, for this person" constantly. Ordering
-- by start_time within a member is exactly this index.
create index if not exists family_calendar_member_start_idx
  on public.family_calendar_entries (member_id, start_time);

-- Feed re-sync deletes a feed's slice of the window by (feed, start_time).
create index if not exists family_calendar_feed_start_idx
  on public.family_calendar_entries (source_feed_id, start_time)
  where source_feed_id is not null;

-- RSVP fan-out on the events list.
create index if not exists family_event_rsvps_member_idx
  on public.family_event_rsvps (member_id);

-- Only active URL feeds are polled; the partial index keeps that scan tiny.
create index if not exists family_calendar_feeds_active_idx
  on public.family_calendar_feeds (is_active)
  where is_active;

-- ---------------------------------------------------------------------------
-- Chores: removed.
--
-- Dropped in dependency order. `family_chores` references the templates, and
-- both reference the recurrence enum, so the enum goes last. Nothing outside
-- the chores feature ever used any of it.
-- ---------------------------------------------------------------------------
drop function if exists public.family_regenerate_future_chores(date, integer);
drop function if exists public.family_generate_chores(date, integer);

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

-- ---------------------------------------------------------------------------
-- RLS + realtime for reactions.
--
-- Same posture as every other family_* table: this dashboard has no login, so
-- the browser holds only the anon key and the policy necessarily grants it.
-- See README ("Security model").
-- ---------------------------------------------------------------------------
alter table public.family_message_reactions enable row level security;

drop policy if exists family_message_reactions_family_access
  on public.family_message_reactions;
create policy family_message_reactions_family_access
  on public.family_message_reactions
  for all to anon, authenticated
  using (true) with check (true);

-- FULL replica identity so a DELETE payload carries the removed row — that is
-- what lets another device un-render a reaction it did not toggle itself.
alter table public.family_message_reactions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_message_reactions;
exception when duplicate_object then null; end $$;
