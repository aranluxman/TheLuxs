-- ============================================================================
--  Family Dashboard — direct messages
--
--  Until now `family_messages` was one room: every row went to the whole
--  house. This adds a recipient, so a message can be addressed to one person.
--
--    recipient_id is null      the group thread — what every existing row is,
--                              which is why there is no backfill here
--    recipient_id = <member>   a direct message between sender and recipient
--
--  `conversation_key` is a generated column holding the two ids sorted and
--  joined. Both directions of a conversation produce the same key, so reading
--  a thread is one indexed equality test rather than a four-way OR that no
--  index can serve and that keyset pagination would have to repeat.
--
--  ---------------------------------------------------------------------------
--  WHAT THIS DOES NOT DO
--
--  It does not make a direct message private. It cannot. There is no login:
--  the browser holds the publishable key, and `family_messages_read` is
--  `using (true)`, so anyone holding that key and the site URL can select
--  every row in this table — direct messages included. The privacy here is the
--  same kind the app already claims for "delete your own messages": a filter
--  in the query, honest about accidents and ordinary use, not about an
--  adversary. Migration 0004's PART 3 is still the fix, and adding DMs makes
--  it more urgent rather than less. See the README's Security model section,
--  which says this in the same words.
--
--  What IS enforced below is shape: a message cannot be addressed to its own
--  sender, and a recipient can never be changed after the fact.
--  ---------------------------------------------------------------------------
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The recipient.
--
--    `on delete cascade` matches sender_id. Removing a member from a browser
--    is already revoked (0004 §1.3), so this cannot be reached by the app.
-- ----------------------------------------------------------------------------
alter table public.family_messages
  add column if not exists recipient_id uuid
    references public.family_members(id) on delete cascade;

comment on column public.family_messages.recipient_id is
  'Null for the group thread; a member id for a direct message. Not privacy — see this migration''s header.';

-- Constraints rather than only a policy, because a policy binds the roles it
-- names and a constraint binds everybody — service_role and whatever role
-- exists here in a year's time included.
--
-- A message addressed to its own sender has no meaning, and it would generate
-- a conversation key indistinguishable from a self-thread.
alter table public.family_messages drop constraint if exists family_messages_dm_not_self;
alter table public.family_messages
  add constraint family_messages_dm_not_self
  check (recipient_id is null or recipient_id is distinct from sender_id);

-- A DM with no sender cannot be keyed, addressed, or deleted by its author.
-- This is also what makes the null branch of the generated column below
-- unreachable rather than merely unlikely — see the note there.
alter table public.family_messages drop constraint if exists family_messages_dm_has_sender;
alter table public.family_messages
  add constraint family_messages_dm_has_sender
  check (recipient_id is null or sender_id is not null);

-- ----------------------------------------------------------------------------
-- 2. The conversation key.
--
--    Two sharp edges here, both deliberate:
--
--    The comparison is on `uuid`, not on `uuid::text`. Sorting the text form
--    would order by the database collation, and a collation that treats the
--    hyphens in a UUID as punctuation does not necessarily agree with the
--    plain lexicographic sort the browser does in `conversationKey()`
--    (src/lib/types.ts). Disagree once and the client asks for a key that no
--    row has, and a conversation silently reads as empty. `uuid` comparison is
--    byte order — no collation, no locale, same answer everywhere.
--
--    least()/greatest() IGNORE nulls in Postgres rather than propagating them
--    — verified, and true of the uuid form too: least(null, r) is r. So a row
--    with a null sender_id and a real recipient would not produce a null key
--    you would notice, it would produce a plausible-looking 'r:r'. That is why
--    family_messages_dm_has_sender above is a constraint and not a comment:
--    the bad input is what has to be unreachable, not the bad output.
-- ----------------------------------------------------------------------------
alter table public.family_messages
  add column if not exists conversation_key text
  generated always as (
    case
      when recipient_id is null then null
      else least(sender_id, recipient_id)::text
           || ':' ||
           greatest(sender_id, recipient_id)::text
    end
  ) stored;

comment on column public.family_messages.conversation_key is
  'Generated: the two member ids sorted and joined, so both directions of a DM share one key. Null for the group thread.';

-- ----------------------------------------------------------------------------
-- 3. Indexes.
--
--    Two partial indexes rather than one composite: the group thread is the
--    hot read and wants nothing but created_at, while a DM thread wants the
--    key first. Partial keeps each one small — a household's group history
--    does not belong in the DM index.
-- ----------------------------------------------------------------------------
create index if not exists family_messages_group_idx
  on public.family_messages (created_at desc)
  where recipient_id is null;

create index if not exists family_messages_dm_idx
  on public.family_messages (conversation_key, created_at desc)
  where recipient_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Sending.
--
--    0004 dropped its family_reset_policy() helper on its last line, so this
--    drops the policy directly, the way 0005 does.
--
--    A message addressed to its own sender is a client bug, never an intent.
-- ----------------------------------------------------------------------------
drop policy if exists family_messages_send on public.family_messages;
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
    -- Group message, or a DM to somebody else. Never to yourself.
    and (recipient_id is null or recipient_id <> sender_id)
  );

-- ----------------------------------------------------------------------------
-- 5. The recipient is immutable.
--
--    0004's column-scoped UPDATE grant already covers this — a column added
--    after that grant is not granted to anyone, so `recipient_id` is not
--    writable from a browser at all, and `conversation_key` is generated and
--    never writable by anybody. This is the belt to that pair of braces: a
--    future `grant update` written without thinking, or a service_role script,
--    still cannot move a message from one conversation into another.
--
--    Replacing the whole function is the only way to add a check to it; the
--    body below is 0004's, plus the recipient_id clause. If 0004 ever changes,
--    this has to be re-synced by hand — there is no way to patch a function
--    body in place, and pretending otherwise is how the two silently diverge.
-- ----------------------------------------------------------------------------
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

  -- Added in 0006. A message cannot be moved between conversations: a DM
  -- cannot be promoted into the group thread, and a group message cannot be
  -- retargeted at one person. conversation_key follows this column, so
  -- pinning it pins both.
  if new.recipient_id is distinct from old.recipient_id then
    raise exception 'family_messages.recipient_id is immutable';
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
    -- see 0004 PART 3 — but no ordinary or buggy client can delete someone
    -- else's. Legacy rows with no sender are exempt; there is nobody to match.
    if old.sender_id is not null and new.deleted_by is distinct from old.sender_id then
      raise exception 'a message may only be deleted by its sender';
    end if;

    -- Deleting must actually remove the content, not just set a flag.
    if coalesce(new.message_text, '') <> '' or new.attachment_path is not null then
      raise exception 'a deleted message must have its content removed';
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
-- 6. Realtime already carries this.
--
--    family_messages is in the supabase_realtime publication with REPLICA
--    IDENTITY FULL (0001), so INSERT payloads arrive with every column,
--    recipient_id included. The client filters on it rather than subscribing
--    per conversation.
--
--    It filters on recipient_id and NOT on conversation_key, and that is not a
--    style choice: conversation_key is a GENERATED column, and Postgres before
--    18 does not emit generated columns to logical replication at all. A
--    client routing incoming rows by conversation_key would work against the
--    REST reads and silently drop every live message.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 7. Tell PostgREST the shape of the table changed.
--
--    It caches the column list. Without this the first insert naming
--    recipient_id is rejected with PGRST204 ("column not found") until the
--    cache happens to refresh on its own — which looks exactly like a bug in
--    the app, on a schema that is in fact already correct.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';
