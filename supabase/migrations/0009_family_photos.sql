-- ============================================================================
--  Family Dashboard — the photo wall
--
--  Photos already had a home in this schema: `family-media`, the private
--  bucket created in 0002, which holds profile pictures and chat attachments.
--  This adds the third kind — pictures posted to the wall on the home screen —
--  and it needs a table rather than a bucket listing for two reasons.
--
--  The bucket is private, so every image is fetched through a signed URL that
--  expires; listing objects would give the app paths but no captions, no
--  ordering it can trust, and no way to say who posted what. And a storage
--  listing cannot be subscribed to, so a photo added on a phone would not
--  appear on the kitchen tablet until someone reloaded it.
--
--  So: one row per photo, pointing at an object under `photos/`. The row is
--  the record; the object is the payload.
--
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.family_photos (
  id           uuid primary key default gen_random_uuid(),

  -- The object path inside `family-media`. Unique because two rows pointing at
  -- one object turn "delete this photo" into a broken image somewhere else,
  -- and constrained to the `photos/` prefix so a row here can never be aimed
  -- at somebody's avatar or a chat attachment and used to delete it.
  storage_path text not null unique check (storage_path ~ '^photos/[A-Za-z0-9._-]{1,120}$'),

  caption      text check (caption is null or length(caption) <= 140),
  uploaded_by  uuid references public.family_members(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- The wall is read newest-first, always.
create index if not exists family_photos_created_idx
  on public.family_photos (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS, in the per-command shape 0005 established.
-- ---------------------------------------------------------------------------
alter table public.family_photos enable row level security;

drop policy if exists family_photos_read on public.family_photos;
create policy family_photos_read on public.family_photos
  for select to anon, authenticated using (true);

drop policy if exists family_photos_add on public.family_photos;
create policy family_photos_add on public.family_photos
  for insert to anon, authenticated
  with check (storage_path ~ '^photos/[A-Za-z0-9._-]{1,120}$');

-- Taking a photo down is ordinary use — a blurry one, a duplicate, one
-- somebody would rather was not on the kitchen wall. Unlike a message, there
-- is no history worth preserving in a picture nobody wants up.
drop policy if exists family_photos_remove on public.family_photos;
create policy family_photos_remove on public.family_photos
  for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime, so a photo taken in the garden is on the kitchen screen by the
-- time you walk back in. FULL replica identity so a DELETE payload carries the
-- removed row and other devices know which tile vanished.
-- ---------------------------------------------------------------------------
alter table public.family_photos replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.family_photos;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Grants. Same doctrine as 0007 and 0008: revoke what the app never does.
--
-- TRUNCATE ignores row-level security entirely, so a per-row delete policy is
-- no obstacle to one statement that empties the wall.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on public.family_photos
  from anon, authenticated;

-- Only the caption is editable. Without this, an update could repoint
-- `storage_path` at another member's avatar and then delete the row to take
-- the picture with it, or reassign `uploaded_by` to blame someone else.
revoke update on public.family_photos from anon, authenticated;
grant update (caption) on public.family_photos to anon, authenticated;
