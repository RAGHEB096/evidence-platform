-- Core schema: profiles, protocols and their hierarchy, evidence, exports,
-- settings and the audit trail. Every table enables RLS and gets its policies
-- here, in the same migration that creates it (CLAUDE.md).
--
-- Conventions
--   * Nothing is reachable through the Data API unless granted below. Default
--     privileges are revoked first, so a table or function added later is
--     private until a migration grants it explicitly.
--   * Every domain row carries protocol_id. Composite foreign keys tie it to
--     the parent's protocol_id, so a policy that checks protocol_id alone
--     cannot be fooled by a parent from another protocol (ADR-011).
--   * Domain rows are soft-deleted (deleted_at, deleted_by). There are no
--     DELETE grants on them (ADR-008).
--   * Writes narrower than a row use column-level grants or RPCs (ADR-003).

-------------------------------------------------------------------------------
-- Privileges: private by default
-------------------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public;
-- Policies call helpers in this schema, so the API roles need USAGE. The
-- schema is not exposed by PostgREST, so this does not publish anything.
grant usage on schema private to authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Types
-------------------------------------------------------------------------------

-- "Archived" is not a status: it is the soft-deleted state (deleted_at) and is
-- shown as such in the UI, so there is one source of truth for it.
create type public.protocol_status as enum ('draft', 'active', 'completed');
-- Declaration order is privilege order: viewer < tester < manager.
create type public.protocol_role as enum ('viewer', 'tester', 'manager');
create type public.step_status as enum ('not_started', 'in_progress', 'passed', 'failed', 'blocked', 'not_applicable');
create type public.export_status as enum ('draft', 'generated');

-------------------------------------------------------------------------------
-- Generic helpers
-------------------------------------------------------------------------------

create function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- user_profiles
-------------------------------------------------------------------------------

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  is_admin boolean not null default false,
  can_create_protocols boolean not null default false,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.user_profiles is 'One row per account. No email or password column: the synthetic Auth email never leaves the server side.';

create index user_profiles_created_by_idx on public.user_profiles (created_by);

create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function private.touch_updated_at();

-- Fingerprint of the password hash at the moment an administrator set it.
-- complete_password_change() compares against it to prove the user really
-- chose a new password before must_change_password is cleared (ADR-012).
-- Stores a SHA-256 of the bcrypt hash, never password material itself.
create table private.password_fingerprints (
  user_id uuid primary key references public.user_profiles (id),
  fingerprint text not null,
  recorded_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- Authorization helpers (ADR-003)
-- security definer so they can read profiles and access rows regardless of
-- the caller's RLS; stable; fixed search_path. All return "no access" for an
-- inactive profile or one that still has to change its password.
-------------------------------------------------------------------------------

create function private.active_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.user_profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and not p.must_change_password
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_admin
    from public.user_profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and not p.must_change_password
  ), false)
$$;

create function private.can_create_protocols()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_admin or p.can_create_protocols
    from public.user_profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and not p.must_change_password
  ), false)
$$;

-------------------------------------------------------------------------------
-- protocols
-------------------------------------------------------------------------------

create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  version text not null default '1.0' check (char_length(btrim(version)) between 1 and 32),
  status public.protocol_status not null default 'draft',
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id)
);
-- Unique across archived rows too, so restoring a protocol can never collide
-- and a reference always identifies one protocol in the record.
create unique index protocols_reference_key on public.protocols (lower(btrim(reference)));
create index protocols_created_by_idx on public.protocols (created_by);
create index protocols_deleted_by_idx on public.protocols (deleted_by);

create trigger protocols_touch before update on public.protocols
  for each row execute function private.touch_updated_at();

create table public.protocol_access (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  user_id uuid not null references public.user_profiles (id),
  role public.protocol_role not null,
  granted_by uuid not null default auth.uid() references public.user_profiles (id),
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (protocol_id, user_id)
);
create index protocol_access_user_idx on public.protocol_access (user_id);
create index protocol_access_granted_by_idx on public.protocol_access (granted_by);

create trigger protocol_access_touch before update on public.protocol_access
  for each row execute function private.touch_updated_at();

-- The caller's role on a protocol, or null. Archived protocols grant nothing
-- to non-administrators.
create function private.protocol_role(p_protocol_id uuid)
returns public.protocol_role
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public.protocol_access a
  join public.protocols pr on pr.id = a.protocol_id and pr.deleted_at is null
  join public.user_profiles p on p.id = a.user_id and p.is_active and not p.must_change_password
  where a.protocol_id = p_protocol_id
    and a.user_id = (select auth.uid())
$$;

-- True if the caller is an administrator or holds at least p_min on the protocol.
create function private.has_protocol_role(p_protocol_id uuid, p_min public.protocol_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or coalesce(private.protocol_role(p_protocol_id) >= p_min, false)
$$;

-------------------------------------------------------------------------------
-- Hierarchy: chapters → functions → test_runs → test_steps (→ sub-steps)
-------------------------------------------------------------------------------

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  position integer not null,
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id)
);
create index chapters_protocol_idx on public.chapters (protocol_id, position);
create index chapters_created_by_idx on public.chapters (created_by);
create index chapters_deleted_by_idx on public.chapters (deleted_by);

create table public.functions (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  chapter_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  position integer not null,
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id),
  unique (id, chapter_id),
  foreign key (chapter_id, protocol_id) references public.chapters (id, protocol_id)
);
create index functions_chapter_idx on public.functions (chapter_id, position);
create index functions_protocol_idx on public.functions (protocol_id);
create index functions_created_by_idx on public.functions (created_by);
create index functions_deleted_by_idx on public.functions (deleted_by);

create table public.test_runs (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  function_id uuid not null,
  reference text not null default '' check (char_length(reference) <= 64),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  position integer not null,
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id),
  unique (id, function_id),
  foreign key (function_id, protocol_id) references public.functions (id, protocol_id)
);
create index test_runs_function_idx on public.test_runs (function_id, position);
create index test_runs_protocol_idx on public.test_runs (protocol_id);
create index test_runs_created_by_idx on public.test_runs (created_by);
create index test_runs_deleted_by_idx on public.test_runs (deleted_by);

create table public.test_steps (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  test_run_id uuid not null,
  parent_step_id uuid,
  reference text not null default '' check (char_length(reference) <= 64),
  description text not null default '' check (char_length(description) <= 10000),
  expected_result text not null default '' check (char_length(expected_result) <= 10000),
  actual_result text not null default '' check (char_length(actual_result) <= 10000),
  status public.step_status not null default 'not_started',
  comments text not null default '' check (char_length(comments) <= 10000),
  executed_by uuid references public.user_profiles (id),
  executed_at timestamptz,
  position integer not null,
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id),
  unique (id, test_run_id),
  foreign key (test_run_id, protocol_id) references public.test_runs (id, protocol_id),
  -- A sub-step belongs to the same test run as its parent. parent_step_id is
  -- never updatable, so cycles cannot form.
  foreign key (parent_step_id, test_run_id) references public.test_steps (id, test_run_id)
);
create index test_steps_run_idx on public.test_steps (test_run_id, parent_step_id, position);
create index test_steps_parent_idx on public.test_steps (parent_step_id);
create index test_steps_protocol_idx on public.test_steps (protocol_id);
create index test_steps_executed_by_idx on public.test_steps (executed_by);
create index test_steps_created_by_idx on public.test_steps (created_by);
create index test_steps_deleted_by_idx on public.test_steps (deleted_by);

-- Assigns position = last among siblings when the caller does not give one,
-- and refuses to add a node under an archived parent.
create function private.prepare_hierarchy_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_archived boolean;
begin
  case tg_table_name
    when 'chapters' then
      select pr.deleted_at is not null into v_parent_archived from public.protocols pr where pr.id = new.protocol_id;
      if new.position is null then
        select coalesce(max(c.position), 0) + 1 into new.position from public.chapters c where c.protocol_id = new.protocol_id;
      end if;
    when 'functions' then
      select c.deleted_at is not null into v_parent_archived from public.chapters c where c.id = new.chapter_id;
      if new.position is null then
        select coalesce(max(f.position), 0) + 1 into new.position from public.functions f where f.chapter_id = new.chapter_id;
      end if;
    when 'test_runs' then
      select f.deleted_at is not null into v_parent_archived from public.functions f where f.id = new.function_id;
      if new.position is null then
        select coalesce(max(r.position), 0) + 1 into new.position from public.test_runs r where r.function_id = new.function_id;
      end if;
    when 'test_steps' then
      if new.parent_step_id is null then
        select r.deleted_at is not null into v_parent_archived from public.test_runs r where r.id = new.test_run_id;
      else
        select s.deleted_at is not null into v_parent_archived from public.test_steps s where s.id = new.parent_step_id;
      end if;
      if new.position is null then
        select coalesce(max(s.position), 0) + 1 into new.position
        from public.test_steps s
        where s.test_run_id = new.test_run_id
          and s.parent_step_id is not distinct from new.parent_step_id;
      end if;
  end case;

  if coalesce(v_parent_archived, false) then
    raise exception 'The parent item is archived. Restore it before adding to it.'
      using errcode = 'P0001', hint = 'parent_archived';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['chapters', 'functions', 'test_runs', 'test_steps'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function private.prepare_hierarchy_insert()', t || '_prepare', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch', t);
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- evidence_files
-------------------------------------------------------------------------------

create table public.evidence_files (
  id uuid primary key,
  protocol_id uuid not null references public.protocols (id),
  chapter_id uuid not null,
  function_id uuid not null,
  test_run_id uuid not null,
  test_step_id uuid,
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  caption text not null default '' check (char_length(caption) <= 500),
  description text not null default '' check (char_length(description) <= 5000),
  uploaded_by uuid not null references public.user_profiles (id),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id),
  foreign key (chapter_id, protocol_id) references public.chapters (id, protocol_id),
  foreign key (function_id, protocol_id) references public.functions (id, protocol_id),
  foreign key (function_id, chapter_id) references public.functions (id, chapter_id),
  foreign key (test_run_id, protocol_id) references public.test_runs (id, protocol_id),
  foreign key (test_run_id, function_id) references public.test_runs (id, function_id),
  foreign key (test_step_id, test_run_id) references public.test_steps (id, test_run_id),
  check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'),
  check (split_part(storage_path, '/', 1) = protocol_id::text and split_part(storage_path, '/', 2) = id::text)
);
comment on table public.evidence_files is 'Rows are created only by the finalize-evidence Edge Function (ADR-004). hash, path and uploader never change.';
create index evidence_files_protocol_idx on public.evidence_files (protocol_id, uploaded_at desc);
create index evidence_files_chapter_idx on public.evidence_files (chapter_id);
create index evidence_files_function_idx on public.evidence_files (function_id);
create index evidence_files_run_idx on public.evidence_files (test_run_id);
create index evidence_files_step_idx on public.evidence_files (test_step_id);
create index evidence_files_uploaded_by_idx on public.evidence_files (uploaded_by);
create index evidence_files_deleted_by_idx on public.evidence_files (deleted_by);

create trigger evidence_files_touch before update on public.evidence_files
  for each row execute function private.touch_updated_at();

-------------------------------------------------------------------------------
-- document_exports, document_export_items (ADR-006)
-------------------------------------------------------------------------------

create table public.document_exports (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status public.export_status not null default 'draft',
  include_steps_without_evidence boolean not null default false,
  storage_path text unique,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint check (file_size_bytes > 0),
  chapter_count integer check (chapter_count >= 0),
  test_run_count integer check (test_run_count >= 0),
  step_count integer check (step_count >= 0),
  image_count integer check (image_count >= 0),
  generated_by uuid references public.user_profiles (id),
  generated_at timestamptz,
  created_by uuid not null default auth.uid() references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles (id),
  unique (id, protocol_id),
  check (status = 'draft' or (generated_at is not null and generated_by is not null and image_count is not null)),
  check (storage_path is null or storage_path = protocol_id::text || '/' || id::text || '.docx')
);
create index document_exports_protocol_idx on public.document_exports (protocol_id, created_at desc);
create index document_exports_generated_by_idx on public.document_exports (generated_by);
create index document_exports_created_by_idx on public.document_exports (created_by);
create index document_exports_deleted_by_idx on public.document_exports (deleted_by);

create trigger document_exports_touch before update on public.document_exports
  for each row execute function private.touch_updated_at();

create table public.document_export_items (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null,
  protocol_id uuid not null,
  evidence_id uuid not null,
  position integer not null default 0,
  caption_override text check (char_length(caption_override) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (export_id, evidence_id),
  foreign key (export_id, protocol_id) references public.document_exports (id, protocol_id),
  foreign key (evidence_id, protocol_id) references public.evidence_files (id, protocol_id)
);
create index document_export_items_evidence_idx on public.document_export_items (evidence_id);
create index document_export_items_protocol_idx on public.document_export_items (protocol_id);

create trigger document_export_items_touch before update on public.document_export_items
  for each row execute function private.touch_updated_at();

-- A generated export and its items are read-only (ADR-006).
create function private.guard_generated_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.export_status;
begin
  if tg_table_name = 'document_exports' then
    if old.status = 'generated' then
      raise exception 'A generated report cannot be changed.' using errcode = 'P0001', hint = 'export_generated';
    end if;
    return new;
  end if;

  select e.status into v_status from public.document_exports e where e.id = coalesce(new.export_id, old.export_id);
  if v_status = 'generated' then
    raise exception 'A generated report cannot be changed.' using errcode = 'P0001', hint = 'export_generated';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger document_exports_guard before update on public.document_exports
  for each row execute function private.guard_generated_export();
create trigger document_export_items_guard before insert or update or delete on public.document_export_items
  for each row execute function private.guard_generated_export();

-------------------------------------------------------------------------------
-- app_settings
-------------------------------------------------------------------------------

create table public.app_settings (
  key text primary key check (key in ('upload_limit_bytes', 'report_page_size', 'image_long_edge_px')),
  value jsonb not null,
  updated_by uuid references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    case key
      -- 1 MB to 50 MB: the Supabase Free plan's per-file maximum.
      when 'upload_limit_bytes' then jsonb_typeof(value) = 'number' and (value::text)::bigint between 1048576 and 52428800
      when 'report_page_size' then value in ('"A4"'::jsonb, '"Letter"'::jsonb)
      when 'image_long_edge_px' then jsonb_typeof(value) = 'number' and (value::text)::integer between 500 and 6000
    end
  )
);
create index app_settings_updated_by_idx on public.app_settings (updated_by);

create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_updated_at();

insert into public.app_settings (key, value) values
  ('upload_limit_bytes', '20971520'),
  ('report_page_size', '"A4"'),
  ('image_long_edge_px', '2000');

-------------------------------------------------------------------------------
-- Protocol "last modified": any change beneath a protocol bumps its updated_at
-------------------------------------------------------------------------------

create function private.bump_protocol_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protocol_id uuid := coalesce(new.protocol_id, old.protocol_id);
begin
  -- Once per transaction per protocol: now() is fixed within a transaction.
  update public.protocols set updated_at = now()
  where id = v_protocol_id and updated_at is distinct from now();
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['chapters', 'functions', 'test_runs', 'test_steps', 'evidence_files'] loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function private.bump_protocol_updated_at()', t || '_bump_protocol', t);
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- Audit trail (ADR-007)
-------------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  protocol_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
comment on table public.audit_events is 'Append-only. Written by triggers and server code; no API role may insert, update or delete.';
create index audit_events_occurred_idx on public.audit_events (occurred_at desc);
create index audit_events_protocol_idx on public.audit_events (protocol_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit events are append-only.' using errcode = 'P0001', hint = 'audit_append_only';
end;
$$;

create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function private.reject_audit_change();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function private.reject_audit_change();

-- The acting user: the JWT subject for API calls, or the actor that trusted
-- server code (Edge Functions through svc_* RPCs) declared for this
-- transaction. Never empty (ADR-007).
create function private.current_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    v_actor := private.try_uuid(nullif(current_setting('app.actor_id', true), ''));
  end if;
  if v_actor is null then
    raise exception 'No acting user for this change.' using errcode = 'P0001', hint = 'audit_actor_missing';
  end if;
  return v_actor;
end;
$$;

create function private.write_audit(
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_protocol_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, protocol_id, metadata)
  values (private.current_actor(), p_event_type, p_entity_type, p_entity_id, p_protocol_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- One generic row trigger for every domain table. TG_ARGV[0] is the entity
-- name used in event types. Changes that touch only updated_at are skipped.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_keys text[];
  v_key text;
  v_event text;
  v_protocol_id uuid;
begin
  v_protocol_id := case
    when v_entity = 'protocol' then (v_row ->> 'id')::uuid
    else private.try_uuid(v_row ->> 'protocol_id')
  end;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    select array_agg(k) into v_keys from jsonb_object_keys(v_changes) as k;
  end if;

  v_event := case
    when tg_op = 'INSERT' then
      case v_entity when 'access' then 'access.granted' when 'selection' then 'selection.added' else v_entity || '.created' end
    when tg_op = 'DELETE' then
      case v_entity when 'access' then 'access.removed' when 'selection' then 'selection.removed' else v_entity || '.deleted' end
    when v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_entity || '.archived'
    when v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then v_entity || '.restored'
    when v_entity = 'access' then 'access.changed'
    when v_entity = 'selection' then 'selection.changed'
    when v_entity = 'test_step'
      and v_keys <@ array['actual_result', 'status', 'comments', 'executed_by', 'executed_at'] then 'test_step.result_recorded'
    when v_entity = 'evidence' and v_keys <@ array['caption', 'description'] then 'evidence.metadata_changed'
    when v_entity = 'document_export' and v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'generated' then 'document_export.generated'
    when v_entity = 'user' and (v_old ->> 'is_active')::boolean and not (v_new ->> 'is_active')::boolean then 'user.deactivated'
    when v_entity = 'user' and not (v_old ->> 'is_active')::boolean and (v_new ->> 'is_active')::boolean then 'user.activated'
    else v_entity || '.updated'
  end;

  perform private.write_audit(
    v_event,
    v_entity,
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    v_protocol_id,
    case tg_op
      when 'INSERT' then jsonb_build_object('row', v_new - 'created_at' - 'updated_at')
      when 'DELETE' then jsonb_build_object('row', v_old - 'created_at' - 'updated_at')
      else jsonb_build_object('changes', v_changes)
    end
  );
  return null;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('user_profiles', 'user'),
      ('protocols', 'protocol'),
      ('protocol_access', 'access'),
      ('chapters', 'chapter'),
      ('functions', 'function'),
      ('test_runs', 'test_run'),
      ('test_steps', 'test_step'),
      ('evidence_files', 'evidence'),
      ('document_exports', 'document_export'),
      ('document_export_items', 'selection'),
      ('app_settings', 'setting')
    ) as t(table_name, entity)
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)',
      r.table_name || '_audit', r.table_name, r.entity
    );
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- Row Level Security and grants
-------------------------------------------------------------------------------

alter table public.user_profiles enable row level security;
alter table public.protocols enable row level security;
alter table public.protocol_access enable row level security;
alter table public.chapters enable row level security;
alter table public.functions enable row level security;
alter table public.test_runs enable row level security;
alter table public.test_steps enable row level security;
alter table public.evidence_files enable row level security;
alter table public.document_exports enable row level security;
alter table public.document_export_items enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_events enable row level security;
alter table private.password_fingerprints enable row level security;

-- Belt and braces: whatever the platform's default grants were, start clean.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

grant execute on function
  private.active_user_id(),
  private.is_admin(),
  private.can_create_protocols(),
  private.protocol_role(uuid),
  private.has_protocol_role(uuid, public.protocol_role),
  private.try_uuid(text)
to authenticated;

-- user_profiles: own row (even while inactive or awaiting a password change,
-- so the client can see why it has no access); administrators see everyone.
-- Other users' names come from user_directory(). Inserts and flag changes go
-- through server code.
grant select on public.user_profiles to authenticated;
grant update (display_name) on public.user_profiles to authenticated;

create policy "profiles: read own or as administrator" on public.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "profiles: change own display name" on public.user_profiles
  for update to authenticated
  using (id = (select private.active_user_id()))
  with check (id = (select private.active_user_id()));

-- protocols: created through create_protocol(); details edited by managers;
-- archived and restored by administrators through archive_node/restore_node.
grant select on public.protocols to authenticated;
grant update (reference, name, description, version, status) on public.protocols to authenticated;

create policy "protocols: read when assigned" on public.protocols
  for select to authenticated
  using (private.has_protocol_role(id, 'viewer'));

create policy "protocols: managers edit details" on public.protocols
  for update to authenticated
  using (deleted_at is null and private.has_protocol_role(id, 'manager'))
  with check (private.has_protocol_role(id, 'manager'));

-- protocol_access: administrators manage; users see their own grants;
-- managers see who else is on their protocols.
grant select on public.protocol_access to authenticated;
grant insert (protocol_id, user_id, role) on public.protocol_access to authenticated;
grant update (role) on public.protocol_access to authenticated;
grant delete on public.protocol_access to authenticated;

create policy "access: read own, or the team as manager" on public.protocol_access
  for select to authenticated
  using (
    user_id = (select private.active_user_id())
    or private.has_protocol_role(protocol_id, 'manager')
  );

create policy "access: administrators grant" on public.protocol_access
  for insert to authenticated
  with check ((select private.is_admin()) and granted_by = (select auth.uid()));

create policy "access: administrators change" on public.protocol_access
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "access: administrators remove" on public.protocol_access
  for delete to authenticated
  using ((select private.is_admin()));

-- Hierarchy tables: everyone on the protocol reads live rows; administrators
-- also read archived rows; managers add and edit. Positions, parents and
-- archive state change only through RPCs.
grant select on public.chapters, public.functions, public.test_runs, public.test_steps to authenticated;
grant insert (protocol_id, title, description) on public.chapters to authenticated;
grant update (title, description) on public.chapters to authenticated;
grant insert (protocol_id, chapter_id, title, description) on public.functions to authenticated;
grant update (title, description) on public.functions to authenticated;
grant insert (protocol_id, function_id, reference, title, description) on public.test_runs to authenticated;
grant update (reference, title, description) on public.test_runs to authenticated;
grant insert (protocol_id, test_run_id, parent_step_id, reference, description, expected_result) on public.test_steps to authenticated;
grant update (reference, description, expected_result) on public.test_steps to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['chapters', 'functions', 'test_runs', 'test_steps'] loop
    execute format($p$
      create policy "%1$s: read when assigned" on public.%1$I
        for select to authenticated
        using (private.has_protocol_role(protocol_id, 'viewer') and (deleted_at is null or (select private.is_admin())))
    $p$, t);
    execute format($p$
      create policy "%1$s: managers add" on public.%1$I
        for insert to authenticated
        with check (private.has_protocol_role(protocol_id, 'manager'))
    $p$, t);
    execute format($p$
      create policy "%1$s: managers edit" on public.%1$I
        for update to authenticated
        using (deleted_at is null and private.has_protocol_role(protocol_id, 'manager'))
        with check (private.has_protocol_role(protocol_id, 'manager'))
    $p$, t);
  end loop;
end;
$$;

-- evidence_files: rows are inserted only by finalize-evidence. Testers edit
-- caption and description of their own uploads; managers edit any.
grant select on public.evidence_files to authenticated;
grant update (caption, description) on public.evidence_files to authenticated;

create policy "evidence: read when assigned" on public.evidence_files
  for select to authenticated
  using (private.has_protocol_role(protocol_id, 'viewer') and (deleted_at is null or (select private.is_admin())));

create policy "evidence: edit metadata" on public.evidence_files
  for update to authenticated
  using (
    deleted_at is null
    and (
      private.has_protocol_role(protocol_id, 'manager')
      or (uploaded_by = (select auth.uid()) and private.has_protocol_role(protocol_id, 'tester'))
    )
  )
  with check (
    private.has_protocol_role(protocol_id, 'manager')
    or (uploaded_by = (select auth.uid()) and private.has_protocol_role(protocol_id, 'tester'))
  );

-- document_exports: any role reads (and downloads saved reports); managers
-- build drafts; finalize_export() records generation.
grant select on public.document_exports to authenticated;
grant insert (protocol_id, name, include_steps_without_evidence) on public.document_exports to authenticated;
grant update (name, include_steps_without_evidence) on public.document_exports to authenticated;

create policy "exports: read when assigned" on public.document_exports
  for select to authenticated
  using (private.has_protocol_role(protocol_id, 'viewer') and (deleted_at is null or (select private.is_admin())));

create policy "exports: managers create drafts" on public.document_exports
  for insert to authenticated
  with check (status = 'draft' and private.has_protocol_role(protocol_id, 'manager'));

create policy "exports: managers edit drafts" on public.document_exports
  for update to authenticated
  using (status = 'draft' and deleted_at is null and private.has_protocol_role(protocol_id, 'manager'))
  with check (status = 'draft' and private.has_protocol_role(protocol_id, 'manager'));

-- document_export_items: the selection. Removing an image from a draft
-- deletes the item row only; the evidence is untouched (ADR-006).
grant select on public.document_export_items to authenticated;
grant insert (export_id, protocol_id, evidence_id, position, caption_override) on public.document_export_items to authenticated;
grant update (position, caption_override) on public.document_export_items to authenticated;
grant delete on public.document_export_items to authenticated;

create policy "selection: read when assigned" on public.document_export_items
  for select to authenticated
  using (private.has_protocol_role(protocol_id, 'viewer'));

create policy "selection: managers add" on public.document_export_items
  for insert to authenticated
  with check (private.has_protocol_role(protocol_id, 'manager'));

create policy "selection: managers change" on public.document_export_items
  for update to authenticated
  using (private.has_protocol_role(protocol_id, 'manager'))
  with check (private.has_protocol_role(protocol_id, 'manager'));

create policy "selection: managers remove" on public.document_export_items
  for delete to authenticated
  using (private.has_protocol_role(protocol_id, 'manager'));

-- app_settings: every active user reads (the upload limit is needed to
-- validate files); administrators change values.
grant select on public.app_settings to authenticated;
grant update (value) on public.app_settings to authenticated;

create policy "settings: read when active" on public.app_settings
  for select to authenticated
  using ((select private.active_user_id()) is not null);

create policy "settings: administrators change" on public.app_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create function private.stamp_setting_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_by := private.current_actor();
  return new;
end;
$$;

create trigger app_settings_stamp before update on public.app_settings
  for each row execute function private.stamp_setting_editor();

-- audit_events: administrators read everything; managers read their own
-- protocols' events. No insert, update or delete grant for any API role.
grant select on public.audit_events to authenticated;

create policy "audit: administrators, and managers for their protocols" on public.audit_events
  for select to authenticated
  using (
    (select private.is_admin())
    or (protocol_id is not null and private.has_protocol_role(protocol_id, 'manager'))
  );

-- password_fingerprints: no policies, no grants. Server code only.
