-- Accounts, first-time setup, protocol creation and storage.
--
-- svc_* functions are callable only with the secret key (service_role). Edge
-- Functions use them so every write carries an explicit acting user for the
-- audit trail (ADR-013): auth.uid() is empty under the secret key.

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- SHA-256 of the user's current bcrypt hash. Changes whenever the password does.
create function private.password_fingerprint(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(u.encrypted_password, 'UTF8')), 'hex')
  from auth.users u
  where u.id = p_user_id
$$;

create function private.record_password_fingerprint(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.password_fingerprints (user_id, fingerprint)
  values (p_user_id, private.password_fingerprint(p_user_id))
  on conflict (user_id) do update set fingerprint = excluded.fingerprint, recorded_at = now();
end;
$$;

-- Declares the acting user for the rest of the transaction (read by
-- private.current_actor()).
create function private.set_actor(p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'An acting user is required.' using errcode = 'P0001', hint = 'audit_actor_missing';
  end if;
  perform set_config('app.actor_id', p_actor::text, true);
end;
$$;

create function private.require_active_admin(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_profiles p
    where p.id = p_user_id and p.is_admin and p.is_active and not p.must_change_password
  ) then
    raise exception 'Only an active administrator can do this.' using errcode = '42501', hint = 'not_admin';
  end if;
end;
$$;

-- Refuses a change that would leave no active administrator.
create function private.assert_other_active_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialise concurrent demotions/deactivations.
  perform pg_advisory_xact_lock(hashtext('evidence-platform:last-admin'));
  if not exists (
    select 1 from public.user_profiles p
    where p.is_admin and p.is_active and p.id <> p_user_id
  ) then
    raise exception 'This would leave no active administrator.' using errcode = 'P0001', hint = 'last_admin';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- First-time setup (ADR-002)
-------------------------------------------------------------------------------

create function public.needs_setup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.user_profiles p where p.is_admin and p.is_active)
$$;
grant execute on function public.needs_setup() to anon, authenticated;

create function public.svc_bootstrap_admin(p_user_id uuid, p_username text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.set_actor(p_user_id);
  -- Second lock behind the setup token: only while no administrator exists.
  perform pg_advisory_xact_lock(hashtext('evidence-platform:last-admin'));
  if exists (select 1 from public.user_profiles p where p.is_admin and p.is_active) then
    raise exception 'Setup has already been completed.' using errcode = 'P0001', hint = 'setup_done';
  end if;

  insert into public.user_profiles (id, username, display_name, is_admin, can_create_protocols, created_by)
  values (p_user_id, p_username, btrim(p_display_name), true, true, p_user_id);

  perform private.record_password_fingerprint(p_user_id);
end;
$$;

-------------------------------------------------------------------------------
-- Account administration (called by the admin-users Edge Function)
-------------------------------------------------------------------------------

create function public.svc_create_user(
  p_actor uuid,
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_is_admin boolean,
  p_can_create_protocols boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin(p_actor);
  perform private.set_actor(p_actor);

  insert into public.user_profiles (id, username, display_name, is_admin, can_create_protocols, must_change_password, created_by)
  values (p_user_id, p_username, btrim(p_display_name), p_is_admin, p_can_create_protocols, true, p_actor);

  perform private.record_password_fingerprint(p_user_id);
end;
$$;

create function public.svc_set_user_active(p_actor uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin(p_actor);
  perform private.set_actor(p_actor);

  if not p_active then
    perform private.assert_other_active_admin(p_user_id);
  end if;

  update public.user_profiles set is_active = p_active where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002', hint = 'user_not_found';
  end if;
end;
$$;

create function public.svc_record_password_reset(p_actor uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin(p_actor);
  perform private.set_actor(p_actor);

  update public.user_profiles set must_change_password = true where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002', hint = 'user_not_found';
  end if;
  perform private.record_password_fingerprint(p_user_id);
  perform private.write_audit('user.password_reset', 'user', p_user_id::text, null, '{}'::jsonb);
end;
$$;

revoke execute on function
  public.svc_bootstrap_admin(uuid, text, text),
  public.svc_create_user(uuid, uuid, text, text, boolean, boolean),
  public.svc_set_user_active(uuid, uuid, boolean),
  public.svc_record_password_reset(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.svc_bootstrap_admin(uuid, text, text),
  public.svc_create_user(uuid, uuid, text, text, boolean, boolean),
  public.svc_set_user_active(uuid, uuid, boolean),
  public.svc_record_password_reset(uuid, uuid)
to service_role;

-------------------------------------------------------------------------------
-- Changing one's own password (ADR-012)
-------------------------------------------------------------------------------

-- Called after supabase.auth.updateUser({ password }). Clears
-- must_change_password only if the password really differs from the one an
-- administrator set, and records the change.
create function public.complete_password_change()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_current text;
  v_recorded text;
begin
  if v_user is null or not exists (select 1 from public.user_profiles p where p.id = v_user and p.is_active) then
    raise exception 'Not signed in.' using errcode = '42501', hint = 'not_signed_in';
  end if;

  v_current := private.password_fingerprint(v_user);
  select f.fingerprint into v_recorded from private.password_fingerprints f where f.user_id = v_user;

  if v_recorded is not distinct from v_current then
    return false;
  end if;

  update public.user_profiles set must_change_password = false where id = v_user and must_change_password;
  perform private.record_password_fingerprint(v_user);
  perform private.write_audit('user.password_changed', 'user', v_user::text, null, '{}'::jsonb);
  return true;
end;
$$;
grant execute on function public.complete_password_change() to authenticated;

-------------------------------------------------------------------------------
-- Directory of names for display (uploader, generated by, audit actor)
-------------------------------------------------------------------------------

create function public.user_directory()
returns table (id uuid, username text, display_name text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.is_active
  from public.user_profiles p
  where (select private.active_user_id()) is not null
  order by p.display_name
$$;
grant execute on function public.user_directory() to authenticated;

-------------------------------------------------------------------------------
-- Protocol creation: the creator becomes its manager in the same transaction
-------------------------------------------------------------------------------

create function public.create_protocol(
  p_reference text,
  p_name text,
  p_description text default '',
  p_version text default '1.0'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select private.active_user_id());
  v_id uuid;
begin
  if v_user is null or not private.can_create_protocols() then
    raise exception 'You are not allowed to create protocols.' using errcode = '42501', hint = 'not_allowed';
  end if;

  if exists (select 1 from public.protocols p where lower(btrim(p.reference)) = lower(btrim(p_reference))) then
    raise exception 'A protocol with this reference already exists.' using errcode = '23505', hint = 'reference_taken';
  end if;

  insert into public.protocols (reference, name, description, version, created_by)
  values (btrim(p_reference), btrim(p_name), coalesce(p_description, ''), coalesce(nullif(btrim(p_version), ''), '1.0'), v_user)
  returning id into v_id;

  insert into public.protocol_access (protocol_id, user_id, role, granted_by)
  values (v_id, v_user, 'manager', v_user);

  return v_id;
end;
$$;
grant execute on function public.create_protocol(text, text, text, text) to authenticated;

-------------------------------------------------------------------------------
-- Storage (ADR-004, ARCHITECTURE section 7)
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence', 'evidence', false, 20971520,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp']),
  ('exports', 'exports', false, 52428800,
    array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- evidence/{protocol_id}/{evidence_id}/{filename}: read by anyone on the
-- protocol, inserted by testers and above. No UPDATE or DELETE policy exists,
-- so originals cannot be overwritten (upsert) or removed through the API.
create policy "evidence objects: read when assigned" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and private.has_protocol_role(private.try_uuid((storage.foldername(name))[1]), 'viewer')
  );

create policy "evidence objects: testers upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
    and private.try_uuid((storage.foldername(name))[1]) is not null
    and private.try_uuid((storage.foldername(name))[2]) is not null
    and private.has_protocol_role(private.try_uuid((storage.foldername(name))[1]), 'tester')
  );

-- exports/{protocol_id}/{export_id}.docx: read by anyone on the protocol,
-- inserted by managers and above. No UPDATE or DELETE policy.
create policy "export objects: read when assigned" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and private.has_protocol_role(private.try_uuid((storage.foldername(name))[1]), 'viewer')
  );

create policy "export objects: managers upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exports'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.docx$'
    and private.try_uuid((storage.foldername(name))[1]) is not null
    and private.has_protocol_role(private.try_uuid((storage.foldername(name))[1]), 'manager')
  );

-- Keep the bucket's own size limit equal to the administrator's setting, so
-- the bucket stays a real second layer (ADR-004).
create function private.sync_evidence_bucket_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'upload_limit_bytes' then
    update storage.buckets set file_size_limit = (new.value::text)::bigint where id = 'evidence';
  end if;
  return null;
end;
$$;

create trigger app_settings_sync_bucket after update on public.app_settings
  for each row execute function private.sync_evidence_bucket_limit();
