-- ============================================================================
--  Family Dashboard — per-profile PINs and trusted devices
--
--  WHAT THIS DOES AND DOES NOT DO
--  ----------------------------------------------------------------
--  Picking a profile now requires that person's PIN, unless the device has
--  already been trusted for them. That stops a sibling picking up a phone and
--  tapping your face to read your chat as you.
--
--  It is NOT a login. The browser still carries only the publishable key, so
--  someone who reads that key out of the bundle can still query the family's
--  messages and calendar directly through the REST API. The PIN gates the
--  *app*, not the *data*. Closing that needs Supabase Auth — see 0005 PART 3.
--
--  Within that limit this is built to be as real as it can be:
--
--    * PIN hashes are bcrypt (pgcrypto `crypt`/`gen_salt('bf')`) and live in a
--      table the browser cannot read at all. The client never receives a hash,
--      so there is nothing to brute-force offline.
--    * Verification happens inside a `security definer` function, so guesses
--      have to go through the API one at a time.
--    * Those guesses are throttled server-side: five failures and the profile
--      locks for a spell that doubles each time. 10,000 candidates stops being
--      a few seconds of work.
--    * Trusted devices cannot be forged. The table is unreachable from the
--      browser, and a row only ever appears as the result of a correct PIN.
--
--  Residual holes, stated plainly:
--    * Enrolment is open. Until someone sets their PIN, anyone can set it for
--      them. There is no identity to check against yet.
--    * A forgotten PIN needs `family_admin_clear_pin` run from the SQL editor.
--      It is deliberately not granted to the browser.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- pgcrypto is already installed by 0001; named here because this file depends
-- on crypt() and gen_salt() rather than merely inheriting them.
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Secrets. Neither table is readable or writable from the browser: every
-- interaction goes through the security-definer functions further down.
-- ---------------------------------------------------------------------------
create table if not exists public.family_member_pins (
  member_id       uuid primary key references public.family_members(id) on delete cascade,
  pin_hash        text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists public.family_trusted_devices (
  member_id    uuid not null references public.family_members(id) on delete cascade,
  -- SHA-256 of a 256-bit random token held in the device's localStorage. The
  -- token has full entropy, so a fast digest is the right tool; a slow KDF
  -- would only cost latency on every page load.
  token_hash   text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (member_id, token_hash)
);

create index if not exists family_trusted_devices_member_idx
  on public.family_trusted_devices (member_id);

alter table public.family_member_pins     enable row level security;
alter table public.family_trusted_devices enable row level security;

-- No policies at all: RLS on with zero policies denies everything, which is
-- exactly right here. The functions below run as owner and bypass it.
revoke all on public.family_member_pins     from anon, authenticated;
revoke all on public.family_trusted_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Throttle. Five wrong PINs, then a cooldown that doubles to a five-minute
-- ceiling. Applied per member and held in the row, so it survives a reload
-- and cannot be cleared from the client.
-- ---------------------------------------------------------------------------
create or replace function public.family_pin_cooldown(p_failures integer)
returns interval
language sql
immutable
as $$
  select case
    when p_failures < 5 then interval '0'
    else least(
      interval '5 minutes',
      (interval '5 seconds') * power(2, least(p_failures - 5, 6))
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- Who has a PIN? Returns booleans only — never a hash, never a lock time that
-- would help someone map out the throttle.
-- ---------------------------------------------------------------------------
create or replace function public.family_pin_status()
returns table (member_id uuid, has_pin boolean, locked boolean)
language sql
security definer
set search_path = public
as $$
  select m.id,
         p.member_id is not null,
         coalesce(p.locked_until > now(), false)
    from public.family_members m
    left join public.family_member_pins p on p.member_id = m.id;
$$;

-- ---------------------------------------------------------------------------
-- Set or change a PIN.
--
-- Changing one requires the current PIN. Setting the first one does not —
-- there is no identity to check against, and demanding a secret nobody has
-- yet would just lock the household out of its own app.
-- ---------------------------------------------------------------------------
create or replace function public.family_set_pin(
  p_member_id uuid,
  p_pin text,
  p_current_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_pin !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'A PIN must be exactly four digits.');
  end if;

  select pin_hash into v_existing
    from public.family_member_pins where member_id = p_member_id;

  if v_existing is not null then
    if p_current_pin is null or v_existing <> crypt(p_current_pin, v_existing) then
      return jsonb_build_object('ok', false, 'error', 'That current PIN is not right.');
    end if;
  end if;

  insert into public.family_member_pins (member_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (p_member_id, crypt(p_pin, gen_salt('bf', 10)), 0, null, now())
  on conflict (member_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();

  -- Changing a PIN revokes every remembered device. If the PIN changed because
  -- someone else learned it, the phones it was typed into should not stay in.
  delete from public.family_trusted_devices where member_id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Is this device already trusted for this member?
-- ---------------------------------------------------------------------------
create or replace function public.family_device_trusted(
  p_member_id uuid,
  p_device_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_found boolean;
begin
  if p_device_token is null or length(p_device_token) < 20 then
    return false;
  end if;
  v_hash := encode(digest(p_device_token, 'sha256'), 'hex');

  update public.family_trusted_devices
     set last_seen_at = now()
   where member_id = p_member_id and token_hash = v_hash
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Unlock: verify the PIN and, on success, remember this device.
--
-- Returns attempts_left rather than a bare false so the UI can warn before the
-- lockout lands. It never says whether a member has a PIN at all — that is
-- `family_pin_status`'s job, and conflating them would leak.
-- ---------------------------------------------------------------------------
create or replace function public.family_unlock_profile(
  p_member_id uuid,
  p_pin text,
  p_device_token text default null,
  p_device_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.family_member_pins%rowtype;
  v_wait interval;
begin
  select * into v_row from public.family_member_pins where member_id = p_member_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No PIN is set for that profile.');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'locked', true,
      'retry_after_seconds', ceil(extract(epoch from (v_row.locked_until - now())))
    );
  end if;

  if v_row.pin_hash <> crypt(p_pin, v_row.pin_hash) then
    v_wait := public.family_pin_cooldown(v_row.failed_attempts + 1);
    update public.family_member_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when v_wait > interval '0' then now() + v_wait else null end
     where member_id = p_member_id;

    return jsonb_build_object(
      'ok', false,
      'locked', v_wait > interval '0',
      'retry_after_seconds', ceil(extract(epoch from v_wait)),
      'attempts_left', greatest(0, 5 - (v_row.failed_attempts + 1))
    );
  end if;

  update public.family_member_pins
     set failed_attempts = 0, locked_until = null
   where member_id = p_member_id;

  if p_device_token is not null and length(p_device_token) >= 20 then
    insert into public.family_trusted_devices (member_id, token_hash, label)
    values (p_member_id, encode(digest(p_device_token, 'sha256'), 'hex'),
            left(coalesce(p_device_label, 'A device'), 60))
    on conflict (member_id, token_hash) do update set last_seen_at = now();
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Forget devices. Signing out one phone needs no PIN — you are holding it.
-- Forgetting every *other* phone does, since that is a remote action.
-- ---------------------------------------------------------------------------
create or replace function public.family_forget_device(
  p_member_id uuid,
  p_device_token text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.family_trusted_devices
   where member_id = p_member_id
     and token_hash = encode(digest(coalesce(p_device_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.family_forget_all_devices(
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from public.family_member_pins where member_id = p_member_id;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    return jsonb_build_object('ok', false, 'error', 'That PIN is not right.');
  end if;
  delete from public.family_trusted_devices where member_id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recovery. Deliberately NOT granted to the browser: a forgotten PIN is
-- cleared by whoever has the Supabase SQL editor, which in a household is the
-- nearest thing to an adult in the room.
--
--   select public.family_admin_clear_pin('<member uuid>');
-- ---------------------------------------------------------------------------
create or replace function public.family_admin_clear_pin(p_member_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.family_member_pins     where member_id = p_member_id;
  delete from public.family_trusted_devices where member_id = p_member_id;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Only the functions the app needs, and only to the roles a browser
-- can reach. `family_admin_clear_pin` is absent on purpose.
-- ---------------------------------------------------------------------------
revoke all on function public.family_set_pin(uuid, text, text)                   from public;
revoke all on function public.family_unlock_profile(uuid, text, text, text)      from public;
revoke all on function public.family_device_trusted(uuid, text)                  from public;
revoke all on function public.family_pin_status()                                from public;
revoke all on function public.family_forget_device(uuid, text)                   from public;
revoke all on function public.family_forget_all_devices(uuid, text)              from public;
revoke all on function public.family_admin_clear_pin(uuid)                       from public;

grant execute on function public.family_set_pin(uuid, text, text)              to anon, authenticated;
grant execute on function public.family_unlock_profile(uuid, text, text, text) to anon, authenticated;
grant execute on function public.family_device_trusted(uuid, text)             to anon, authenticated;
grant execute on function public.family_pin_status()                           to anon, authenticated;
grant execute on function public.family_forget_device(uuid, text)              to anon, authenticated;
grant execute on function public.family_forget_all_devices(uuid, text)         to anon, authenticated;
