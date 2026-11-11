-- Owner feedback (2026-11-11), ADR-017:
-- 1. Protocol lifecycle Draft → Released → Completed. Outside Draft, the
--    structure (chapters, functions, test runs, step definitions, order,
--    archive state) and the protocol's details are locked. Results and
--    evidence remain open. Setting a protocol back to Draft unlocks it; every
--    status change is audited as protocol.updated.
-- 2. A step that has sub-steps takes its status from them, so it cannot be
--    set directly.

alter type public.protocol_status rename value 'active' to 'released';

-------------------------------------------------------------------------------
-- Structure lock
-------------------------------------------------------------------------------

create function private.require_draft_protocol(p_protocol_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.protocol_status;
begin
  select status into v_status from public.protocols where id = p_protocol_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'This protocol is % . Set it back to Draft to change its structure.', initcap(v_status::text)
      using errcode = 'P0001', hint = 'protocol_locked';
  end if;
end;
$$;

-- Structure tables: inserts and any change except updated_at need a draft protocol.
-- test_steps: execution fields (result, status, comments, executor) stay open.
create function private.guard_structure_lock()
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
    if tg_table_name = 'test_steps'
       and v_changed <@ array['actual_result', 'status', 'comments', 'executed_by', 'executed_at'] then
      return new;
    end if;
  end if;

  perform private.require_draft_protocol(new.protocol_id);
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['chapters', 'functions', 'test_runs', 'test_steps'] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.guard_structure_lock()',
      t || '_structure_lock', t
    );
  end loop;
end;
$$;

-- Protocol details (reference, name, description, version) are part of the
-- locked definition; the status itself and archive state can always change.
create function private.guard_protocol_details_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.reference, new.name, new.description, new.version)
         is distinct from (old.reference, old.name, old.description, old.version) then
    raise exception 'This protocol is % . Set it back to Draft to change its details.', initcap(old.status::text)
      using errcode = 'P0001', hint = 'protocol_locked';
  end if;
  return new;
end;
$$;

create trigger protocols_details_lock before update on public.protocols
  for each row execute function private.guard_protocol_details_lock();

-------------------------------------------------------------------------------
-- Steps with sub-steps take their status from them
-------------------------------------------------------------------------------

create or replace function public.record_step_result(
  p_step_id uuid,
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
  v_step record;
begin
  select s.protocol_id, s.deleted_at, r.deleted_at as run_deleted_at, s.actual_result, s.status, s.comments
    into v_step
  from public.test_steps s join public.test_runs r on r.id = s.test_run_id
  where s.id = p_step_id;
  if not found then
    raise exception 'The step was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;

  perform private.require_protocol_role(v_step.protocol_id, 'tester');

  if v_step.deleted_at is not null or v_step.run_deleted_at is not null then
    raise exception 'Archived items cannot be changed.' using errcode = 'P0001', hint = 'archived';
  end if;
  if char_length(coalesce(p_actual_result, '')) > 10000 or char_length(coalesce(p_comments, '')) > 10000 then
    raise exception 'Results and comments are at most 10,000 characters.' using errcode = '23514', hint = 'too_long';
  end if;
  if p_status is distinct from v_step.status
     and exists (select 1 from public.test_steps c where c.parent_step_id = p_step_id and c.deleted_at is null) then
    raise exception 'This step''s status follows its sub-steps.' using errcode = 'P0001', hint = 'status_derived';
  end if;

  if (v_step.actual_result, v_step.status, v_step.comments)
     is not distinct from (coalesce(p_actual_result, ''), p_status, coalesce(p_comments, '')) then
    return;
  end if;

  update public.test_steps
  set actual_result = coalesce(p_actual_result, ''),
      status = p_status,
      comments = coalesce(p_comments, ''),
      executed_by = (select auth.uid()),
      executed_at = now()
  where id = p_step_id;
end;
$$;
