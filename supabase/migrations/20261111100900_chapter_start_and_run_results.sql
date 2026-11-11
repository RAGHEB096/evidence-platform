-- Owner feedback (2026-11-11), ADR-018:
-- 1. A protocol's chapter numbering can start at any number (chapter_start).
-- 2. A test run without steps records its own expected result, actual
--    result, status and comments. With live steps its status stays derived.

-------------------------------------------------------------------------------
-- Columns
-------------------------------------------------------------------------------

alter table public.protocols
  add column chapter_start integer not null default 1 check (chapter_start between 0 and 9999);

alter table public.test_runs
  add column expected_result text not null default '' check (char_length(expected_result) <= 10000),
  add column actual_result text not null default '' check (char_length(actual_result) <= 10000),
  add column status public.step_status not null default 'not_started',
  add column comments text not null default '' check (char_length(comments) <= 10000),
  add column executed_by uuid references public.user_profiles (id),
  add column executed_at timestamptz;

create index test_runs_executed_by_idx on public.test_runs (executed_by);

-- Definition fields are written by managers (RLS and the Draft lock apply);
-- execution fields only through record_test_run_result.
grant update (chapter_start) on public.protocols to authenticated;
grant insert (expected_result) on public.test_runs to authenticated;
grant update (expected_result) on public.test_runs to authenticated;

-------------------------------------------------------------------------------
-- Draft lock: execution fields of test runs stay open, like those of steps
-------------------------------------------------------------------------------

create or replace function private.guard_structure_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key), '{}') into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key <> 'updated_at';

    if v_changed = '{}' then
      return new;
    end if;
    if tg_table_name in ('test_steps', 'test_runs')
       and v_changed <@ array['actual_result', 'status', 'comments', 'executed_by', 'executed_at'] then
      return new;
    end if;
  end if;

  perform private.require_draft_protocol(new.protocol_id);
  return new;
end;
$$;

create or replace function private.guard_protocol_details_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.reference, new.name, new.description, new.version, new.chapter_start)
         is distinct from (old.reference, old.name, old.description, old.version, old.chapter_start) then
    raise exception 'This protocol is % . Set it back to Draft to change its details.', initcap(old.status::text)
      using errcode = 'P0001', hint = 'protocol_locked';
  end if;
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- Recording a result on a test run without steps
-------------------------------------------------------------------------------

create function public.record_test_run_result(
  p_test_run_id uuid,
  p_actual_result text,
  p_status public.step_status,
  p_comments text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
begin
  select r.protocol_id, r.deleted_at, r.actual_result, r.status, r.comments into v_run
  from public.test_runs r where r.id = p_test_run_id;
  if not found then
    raise exception 'The test run was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;

  perform private.require_protocol_role(v_run.protocol_id, 'tester');

  if v_run.deleted_at is not null then
    raise exception 'Archived items cannot be changed.' using errcode = 'P0001', hint = 'archived';
  end if;
  if char_length(coalesce(p_actual_result, '')) > 10000 or char_length(coalesce(p_comments, '')) > 10000 then
    raise exception 'Results and comments are at most 10,000 characters.' using errcode = '23514', hint = 'too_long';
  end if;
  if p_status is distinct from v_run.status
     and exists (select 1 from public.test_steps s where s.test_run_id = p_test_run_id and s.deleted_at is null) then
    raise exception 'This test run''s status follows its steps.' using errcode = 'P0001', hint = 'status_derived';
  end if;

  if (v_run.actual_result, v_run.status, v_run.comments)
     is not distinct from (coalesce(p_actual_result, ''), p_status, coalesce(p_comments, '')) then
    return;
  end if;

  update public.test_runs
  set actual_result = coalesce(p_actual_result, ''),
      status = p_status,
      comments = coalesce(p_comments, ''),
      executed_by = (select auth.uid()),
      executed_at = now()
  where id = p_test_run_id;
end;
$$;
grant execute on function public.record_test_run_result(uuid, text, public.step_status, text) to authenticated;

-------------------------------------------------------------------------------
-- Duplicating a test run copies its expected result (execution is reset)
-------------------------------------------------------------------------------

create or replace function private.copy_test_run(p_source uuid, p_target_function uuid, p_position integer, p_suffix text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_protocol uuid;
begin
  insert into public.test_runs (protocol_id, function_id, reference, title, description, expected_result, position)
  select r.protocol_id, p_target_function, r.reference, left(r.title || p_suffix, 200), r.description, r.expected_result, p_position
  from public.test_runs r where r.id = p_source
  returning id, protocol_id into v_new, v_protocol;
  perform private.copy_steps(p_source, v_new, v_protocol);
  return v_new;
end;
$$;

-------------------------------------------------------------------------------
-- Audit: results recorded on a test run get their own event type
-------------------------------------------------------------------------------

create or replace function private.audit_row_change()
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
    when v_entity in ('test_step', 'test_run')
      and v_keys <@ array['actual_result', 'status', 'comments', 'executed_by', 'executed_at'] then v_entity || '.result_recorded'
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

-------------------------------------------------------------------------------
-- Dashboard progress: a test run without steps counts as one recorded item
-------------------------------------------------------------------------------

create or replace function public.protocol_overview()
returns table (
  id uuid,
  reference text,
  name text,
  version text,
  status public.protocol_status,
  chapters bigint,
  test_runs bigint,
  steps bigint,
  steps_executed bigint,
  steps_passed bigint,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recorded as (
    -- Steps without live sub-steps…
    select s.protocol_id, s.status
    from public.test_steps s
    join public.test_runs r on r.id = s.test_run_id and r.deleted_at is null
    where s.deleted_at is null
      and not exists (select 1 from public.test_steps c where c.parent_step_id = s.id and c.deleted_at is null)
    union all
    -- …and test runs without live steps.
    select r.protocol_id, r.status
    from public.test_runs r
    where r.deleted_at is null
      and not exists (select 1 from public.test_steps s where s.test_run_id = r.id and s.deleted_at is null)
  )
  select
    p.id, p.reference, p.name, p.version, p.status,
    (select count(*) from public.chapters c where c.protocol_id = p.id and c.deleted_at is null),
    (select count(*) from public.test_runs r where r.protocol_id = p.id and r.deleted_at is null),
    (select count(*) from recorded l where l.protocol_id = p.id),
    (select count(*) from recorded l where l.protocol_id = p.id and l.status in ('passed', 'failed', 'blocked', 'not_applicable')),
    (select count(*) from recorded l where l.protocol_id = p.id and l.status = 'passed'),
    p.updated_at
  from public.protocols p
  where p.deleted_at is null
  order by p.updated_at desc
$$;
