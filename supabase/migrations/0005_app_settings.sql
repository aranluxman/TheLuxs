-- ============================================================================
--  Family Dashboard — household settings
--
--  One tiny key/value table so a choice made on the kitchen tablet shows up on
--  everyone's phone. Its first tenant is the app icon: the family photo that
--  replaces the default house mark in the header, the browser tab and the iOS
--  home screen.
--
--  The app works without this migration — it falls back to storing the icon in
--  the browser, so it is per-device instead of shared — but the icon does not
--  travel until this has been run.
--
--  Same honesty as 0004: there is no login, so these policies constrain the
--  *shape* of what can be written, never who writes it.
--
--  Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.family_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.family_settings is
  'Household-wide preferences, one row per setting. Readable by anyone with the publishable key.';

-- ----------------------------------------------------------------------------
-- Keys are an allowlist, not free text. Without this the table is an open
-- write target for anyone holding the publishable key: a place to park
-- arbitrary rows in the family''s database.
-- ----------------------------------------------------------------------------
alter table public.family_settings
  drop constraint if exists family_settings_known_key;
alter table public.family_settings
  add constraint family_settings_known_key check (key in ('app_icon'));

-- Values are small by construction — the icon row holds a storage path, not the
-- image. A cap keeps a buggy client from writing a data URL in here.
alter table public.family_settings
  drop constraint if exists family_settings_value_size;
alter table public.family_settings
  add constraint family_settings_value_size check (length(value::text) <= 2048);

-- ----------------------------------------------------------------------------
-- `updated_at` is maintained here rather than trusted from the client, so
-- "who changed the icon last" cannot be back-dated.
-- ----------------------------------------------------------------------------
create or replace function public.family_settings_touch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists family_settings_touch_trg on public.family_settings;
create trigger family_settings_touch_trg
  before insert or update on public.family_settings
  for each row execute function public.family_settings_touch();

-- ----------------------------------------------------------------------------
-- A setting is cleared by writing an empty value, never by removing the row —
-- so there is no DELETE grant, matching how the rest of the schema treats
-- history.
-- ----------------------------------------------------------------------------
revoke delete on public.family_settings from anon, authenticated;

alter table public.family_settings enable row level security;

drop policy if exists family_settings_read on public.family_settings;
create policy family_settings_read on public.family_settings
  for select to anon, authenticated using (true);

drop policy if exists family_settings_write on public.family_settings;
create policy family_settings_write on public.family_settings
  for insert to anon, authenticated with check (true);

drop policy if exists family_settings_edit on public.family_settings;
create policy family_settings_edit on public.family_settings
  for update to anon, authenticated using (true) with check (true);
-- No DELETE policy: see above.

grant select, insert, update on public.family_settings to anon, authenticated;
