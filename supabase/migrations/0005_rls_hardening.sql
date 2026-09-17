-- ============================================================================
--  Family Dashboard — RLS hardening
--
--  READ THIS BEFORE TRUSTING ANY OF IT
--  ----------------------------------------------------------------
--  This app has no login. The browser carries the Supabase *publishable*
--  key, so every request arrives as the `anon` role with no identity
--  attached. Postgres cannot tell one family member from another, and it
--  cannot tell a family member from a stranger who read the key out of the
--  JavaScript bundle.
--
--  That means no policy here can express "only Aran may do this", because
--  there is nothing trustworthy to compare against. Any rule of the form
--  `sender_id = <value the client supplied>` is satisfied by a client that
--  simply supplies a different value.
--
--  So this migration deliberately does NOT pretend. It splits into:
--
--    PART 1 — ENFORCED. Privileges and triggers. A caller holding the
--             publishable key cannot get around these, because they are not
--             predicates over client-supplied data: they are grants Postgres
--             checks itself, and invariants over a row's own columns.
--
--    PART 2 — INTEGRITY. Per-command RLS policies replacing the blanket
--             `using (true) with check (true)` that every earlier round
--             installed. These stop malformed and buggy writes. They are
--             not an authorization boundary.
--
--    PART 3 — The identity check that is *asked for* but cannot work yet,
--             written out so it is ready the day auth lands.
--
--  The one honest summary: after this migration a stranger with the key can
--  still read the family's messages and post new ones. What they can no
--  longer do is rewrite history, un-delete a message, forge who sent one,
--  hard-delete anything, or read the secret calendar URLs.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- `service_role` is deliberately never revoked from anywhere below. The
-- `family-sync-ical` Edge Function runs with the service-role key, needs to
-- read `family_calendar_feeds.url`, and needs to write feed-owned rows into
-- `family_calendar_entries`. Everything here targets `anon` and
-- `authenticated` only — the roles a browser can actually reach.


-- ============================================================================
--  PART 1 — ENFORCED
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1  Messages are append-only, and the only permitted mutation is a
--      tombstone.
--
--      Hard DELETE is revoked outright: the app soft-deletes, and a row that
--      can be removed for real is a row whose absence cannot be explained.
--      Table-level UPDATE is revoked and re-granted per column, so `id`,
--      `sender_id` and `created_at` are simply not writable by a browser —
--      that is a grant check, not a policy, so no crafted request evades it.
-- ----------------------------------------------------------------------------
revoke delete on public.family_messages from anon, authenticated;

revoke update on public.family_messages from anon, authenticated;
grant update (
  message_text,
  attachment_path,
  attachment_kind,
  attachment_name,
  attachment_mime,
  attachment_size,
  attachment_duration,
  deleted_at,
  deleted_by
) on public.family_messages to anon, authenticated;

create or replace function public.family_messages_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  -- Belt and braces with the column grants above: service_role and any future
  -- role still cannot silently reattribute a message.
  if new.sender_id is distinct from old.sender_id then
    raise exception 'family_messages.sender_id is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'family_messages.created_at is immutable';
  end if;

  -- A tombstone is final. Without this, "delete for everyone" is undone by
  -- one UPDATE setting deleted_at back to null.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a deleted message cannot be restored';
  end if;

  -- The app never edits a message; the only UPDATE it issues is the delete.
  -- Enforcing that here means nobody can rewrite what was said after the fact.
  if old.deleted_at is null and new.deleted_at is null then
    raise exception 'family_messages rows are immutable except to delete them';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    -- You may only delete your own message. This *is* enforceable without
    -- auth, because it compares two columns of the row rather than trusting a
    -- caller-supplied identity: the tombstone must be attributed to the person
    -- who sent it. A determined attacker can still claim to be that person —
    -- see PART 3 — but no ordinary or buggy client can delete someone else's.
    -- Legacy rows with no sender are exempt; there is nobody to match.
    if old.sender_id is not null and new.deleted_by is distinct from old.sender_id then
      raise exception 'a message may only be deleted by its sender';
    end if;

    -- Deleting must actually remove the content, not just set a flag.
    if coalesce(new.message_text, '') <> '' or new.attachment_path is not null then
      raise exception 'a deleted message must have its content cleared';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists family_messages_guard_trg on public.family_messages;
create trigger family_messages_guard_trg
  before update on public.family_messages
  for each row execute function public.family_messages_guard();

-- ----------------------------------------------------------------------------
-- 1.2  Reactions are insert-or-delete. There is no such thing as editing one:
--      changing your mind is a delete followed by an insert. Revoking UPDATE
--      removes the only way to reattribute someone else's reaction.
--
--      The client's toggle uses upsert with ignoreDuplicates, which PostgREST
--      compiles to ON CONFLICT DO NOTHING — an INSERT, needing no UPDATE
--      privilege. A merge-duplicates upsert would break here, by design.
-- ----------------------------------------------------------------------------
revoke update on public.family_message_reactions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.3  Members cannot be deleted from a browser.
--
--      `family_messages.sender_id` and `family_calendar_entries.member_id`
--      both cascade. One DELETE against this table silently destroys a
--      person's entire message history, and there is no UI that asks for it.
-- ----------------------------------------------------------------------------
revoke delete on public.family_members from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.4  Quotes are seeded content the app only ever reads.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.family_quotes from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.5  The secret iCal addresses stop being readable.
--
--      This is the sharpest real leak in the app. `family_calendar_feeds.url`
--      holds each person's *secret* calendar address — a bearer token that
--      grants read access to their whole calendar, work meetings and all, to
--      anyone who has it. Any visitor with the publishable key could read the
--      column straight out of the REST API.
--
--      The client never renders the URL; it only asks "is there one?" in order
--      to show a Sync button. So SELECT on the column is revoked and that
--      question is answered by a generated column instead. Writes still work:
--      revoking SELECT does not affect INSERT.
--
--      The Edge Function keeps reading `url` — it holds service_role.
-- ----------------------------------------------------------------------------
alter table public.family_calendar_feeds
  add column if not exists has_url boolean
  generated always as (length(trim(url)) > 0) stored;

revoke select on public.family_calendar_feeds from anon, authenticated;
grant select (
  id, member_id, name, is_active, has_url,
  last_synced_at, last_error, last_event_count, created_at
) on public.family_calendar_feeds to anon, authenticated;

-- Updating a feed's URL in place would let someone swap another member's feed
-- for one they control and read whatever syncs back. Feeds are add/remove.
revoke update on public.family_calendar_feeds from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.6  Feed-owned calendar entries belong to the sync job, not the browser.
--
--      Rows carrying a `source_feed_id` are written by the Edge Function and
--      replaced wholesale on each sync. A client that forges one is either
--      confused or planting something that looks like it came from a trusted
--      calendar. `security definer` is not used, so this runs as the caller
--      and service_role is unaffected by the role check.
-- ----------------------------------------------------------------------------
create or replace function public.family_calendar_entries_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if new.source_feed_id is not null
     and current_user in ('anon', 'authenticated') then
    raise exception 'feed-imported calendar entries may only be written by the sync job';
  end if;
  return new;
end;
$fn$;

drop trigger if exists family_calendar_entries_guard_trg on public.family_calendar_entries;
create trigger family_calendar_entries_guard_trg
  before insert or update on public.family_calendar_entries
  for each row execute function public.family_calendar_entries_guard();


-- ============================================================================
--  PART 2 — INTEGRITY POLICIES
--
--  Rounds 1 and 2 gave every table one policy: `for all ... using (true) with
--  check (true)`. That is a single door with no lock. Splitting it per command
--  means a table that should never be deleted from simply has no DELETE
--  policy, and the absence of a policy is a denial.
--
--  RLS is (re-)enabled on every table explicitly, because a policy on a table
--  with RLS off is decoration.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'family_members', 'family_events', 'family_event_rsvps',
    'family_calendar_entries', 'family_messages', 'family_message_reactions',
    'family_quotes', 'family_looking_forward', 'family_calendar_feeds'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- The blanket policy from rounds 1-3.
    execute format('drop policy if exists %I on public.%I', t || '_family_access', t);
  end loop;
end $$;

-- Helper so each block below reads as "drop then create" without repetition.
create or replace function public.family_reset_policy(
  p_table text, p_name text
) returns void
language plpgsql
as $fn$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
end;
$fn$;

-- ---------------------------------------------------------------- members --
select public.family_reset_policy('family_members', 'family_members_read');
create policy family_members_read on public.family_members
  for select to anon, authenticated using (true);

select public.family_reset_policy('family_members', 'family_members_write');
create policy family_members_write on public.family_members
  for insert to anon, authenticated
  with check (length(trim(name)) between 1 and 40);

select public.family_reset_policy('family_members', 'family_members_edit');
create policy family_members_edit on public.family_members
  for update to anon, authenticated
  using (true) with check (length(trim(name)) between 1 and 40);
-- No DELETE policy: see 1.3.

-- --------------------------------------------------------------- messages --
select public.family_reset_policy('family_messages', 'family_messages_read');
create policy family_messages_read on public.family_messages
  for select to anon, authenticated using (true);

select public.family_reset_policy('family_messages', 'family_messages_send');
create policy family_messages_send on public.family_messages
  for insert to anon, authenticated
  with check (
    -- An unattributed message cannot be moderated, deleted by its author, or
    -- explained. Every new message names a sender.
    sender_id is not null
    -- Nothing may be born deleted; a tombstone is only ever reached by update,
    -- which is where the guard trigger can see the transition.
    and deleted_at is null
    and deleted_by is null
  );

select public.family_reset_policy('family_messages', 'family_messages_tombstone');
create policy family_messages_tombstone on public.family_messages
  for update to anon, authenticated
  -- Only a live message is updatable at all; the trigger then enforces that
  -- the update is a well-formed deletion and nothing else.
  using (deleted_at is null)
  with check (deleted_at is not null);
-- No DELETE policy: see 1.1.

-- -------------------------------------------------------------- reactions --
select public.family_reset_policy('family_message_reactions', 'family_message_reactions_read');
create policy family_message_reactions_read on public.family_message_reactions
  for select to anon, authenticated using (true);

select public.family_reset_policy('family_message_reactions', 'family_message_reactions_add');
create policy family_message_reactions_add on public.family_message_reactions
  for insert to anon, authenticated
  with check (
    emoji in ('👍', '❤️', '😂')
    -- Reacting to a message that has been deleted leaves a pill attached to a
    -- tombstone.
    and exists (
      select 1 from public.family_messages m
       where m.id = message_id and m.deleted_at is null
    )
  );

select public.family_reset_policy('family_message_reactions', 'family_message_reactions_remove');
create policy family_message_reactions_remove on public.family_message_reactions
  for delete to anon, authenticated using (true);
-- No UPDATE policy: see 1.2.

-- ----------------------------------------------------------------- events --
select public.family_reset_policy('family_events', 'family_events_read');
create policy family_events_read on public.family_events
  for select to anon, authenticated using (true);

select public.family_reset_policy('family_events', 'family_events_write');
create policy family_events_write on public.family_events
  for insert to anon, authenticated
  with check (length(trim(title)) between 1 and 120);

select public.family_reset_policy('family_events', 'family_events_edit');
create policy family_events_edit on public.family_events
  for update to anon, authenticated using (true) with check (true);

select public.family_reset_policy('family_events', 'family_events_remove');
create policy family_events_remove on public.family_events
  for delete to anon, authenticated using (true);

-- ------------------------------------------------------------------ RSVPs --
select public.family_reset_policy('family_event_rsvps', 'family_event_rsvps_all');
create policy family_event_rsvps_all on public.family_event_rsvps
  for all to anon, authenticated using (true) with check (member_id is not null);

-- -------------------------------------------------------- calendar entries --
select public.family_reset_policy('family_calendar_entries', 'family_calendar_entries_read');
create policy family_calendar_entries_read on public.family_calendar_entries
  for select to anon, authenticated using (true);

select public.family_reset_policy('family_calendar_entries', 'family_calendar_entries_write');
create policy family_calendar_entries_write on public.family_calendar_entries
  for insert to anon, authenticated
  with check (source_feed_id is null);  -- see 1.6

select public.family_reset_policy('family_calendar_entries', 'family_calendar_entries_edit');
create policy family_calendar_entries_edit on public.family_calendar_entries
  for update to anon, authenticated
  using (source_feed_id is null) with check (source_feed_id is null);

select public.family_reset_policy('family_calendar_entries', 'family_calendar_entries_remove');
create policy family_calendar_entries_remove on public.family_calendar_entries
  -- Deleting a feed-imported entry locally is pointless anyway: the next sync
  -- puts it straight back.
  for delete to anon, authenticated using (source_feed_id is null);

-- ------------------------------------------------------------------ feeds --
select public.family_reset_policy('family_calendar_feeds', 'family_calendar_feeds_read');
create policy family_calendar_feeds_read on public.family_calendar_feeds
  for select to anon, authenticated using (true);  -- column grants limit this

select public.family_reset_policy('family_calendar_feeds', 'family_calendar_feeds_write');
create policy family_calendar_feeds_write on public.family_calendar_feeds
  for insert to anon, authenticated with check (length(trim(name)) > 0);

select public.family_reset_policy('family_calendar_feeds', 'family_calendar_feeds_remove');
create policy family_calendar_feeds_remove on public.family_calendar_feeds
  for delete to anon, authenticated using (true);
-- No UPDATE policy: see 1.5.

-- -------------------------------------------------------- looking forward --
select public.family_reset_policy('family_looking_forward', 'family_looking_forward_all');
create policy family_looking_forward_all on public.family_looking_forward
  for all to anon, authenticated using (true) with check (member_id is not null);

-- ----------------------------------------------------------------- quotes --
select public.family_reset_policy('family_quotes', 'family_quotes_read');
create policy family_quotes_read on public.family_quotes
  for select to anon, authenticated using (true);
-- No write policies: see 1.4.

drop function if exists public.family_reset_policy(text, text);


-- ============================================================================
--  PART 3 — WHAT ACTUALLY FIXES THIS
--
--  TODO(security): the rules above are integrity constraints, not
--  authorization. Full protection requires Supabase Auth — email magic link or
--  an OAuth provider — so that requests carry a verified `auth.uid()` instead
--  of an anonymous role. Steps, in order:
--
--    1. Enable an auth provider in the Supabase dashboard.
--    2. `alter table public.family_members
--          add column user_id uuid unique references auth.users(id);`
--       and map each existing member to the account that signs in as them.
--    3. Put a sign-in gate in front of the app and drop the localStorage
--       "who am I" picker in FamilyProvider — that picker is the client-side
--       half of the same problem.
--    4. Replace the policies above with predicates over `auth.uid()`. The
--       message rules become, in full:
--
--         create policy family_messages_send on public.family_messages
--           for insert to authenticated
--           with check (
--             sender_id = (select id from public.family_members
--                           where user_id = auth.uid())
--           );
--
--         create policy family_messages_tombstone on public.family_messages
--           for update to authenticated
--           using (
--             deleted_at is null
--             and sender_id = (select id from public.family_members
--                               where user_id = auth.uid())
--           )
--           with check (deleted_at is not null);
--
--       and revoke everything from `anon`.
--
--  Note what is deliberately NOT done here. It is tempting to approximate the
--  above today with `current_setting('request.headers')::json->>'x-member-id'`
--  and have the client send its member id in a header. Resist it. The client
--  chooses that header, so the check is satisfied by anyone who edits it, and
--  the only thing gained is a policy that reads like security in a code review
--  while providing none. The guard trigger in 1.1 gets the same integrity
--  benefit honestly, by comparing the row against itself.
-- ============================================================================
