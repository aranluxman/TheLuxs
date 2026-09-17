-- ============================================================================
--  Family Dashboard, round 3 — message reactions (👍 ❤️ 😂) on the group chat,
--  plus the indexes the first two rounds left out.
--
--  Nothing here drops anything. Removing the chores feature is round 4, kept
--  separate on purpose: bundling a destructive drop with the table the chat
--  needs is what left this migration unrun, and the live site throwing
--  "Could not find the table 'public.family_message_reactions'".
--
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

-- ❤️ is U+2764 U+FE0F — the variation selector is part of the value the client
-- sends (`REACTION_EMOJI` in src/lib/types.ts). Dropping it here would make
-- every heart fail this check.
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
-- Without it `payload.old` arrives as the primary key only, and `useReactions`
-- drops the event for want of an emoji.
alter table public.family_message_reactions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_message_reactions;
exception when duplicate_object then null; end $$;
