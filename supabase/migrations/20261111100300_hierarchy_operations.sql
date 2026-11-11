-- Structure operations that span several rows: reorder, archive, restore,
-- duplicate, and the descendant counts shown before archiving.
-- Each checks the caller's role itself (security definer, ADR-003).

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- Protocol of any node; raises if the node does not exist.
create function private.node_protocol(p_node_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_protocol uuid;
begin
  case p_node_type
    when 'protocol' then select id into v_protocol from public.protocols where id = p_id;
    when 'chapter' then select protocol_id into v_protocol from public.chapters where id = p_id;
    when 'function' then select protocol_id into v_protocol from public.functions where id = p_id;
    when 'test_run' then select protocol_id into v_protocol from public.test_runs where id = p_id;
    when 'test_step' then select protocol_id into v_protocol from public.test_steps where id = p_id;
    when 'evidence' then select protocol_id into v_protocol from public.evidence_files where id = p_id;
    else raise exception 'Unknown item type.' using errcode = '22023', hint = 'invalid_node_type';
  end case;
  if v_protocol is null then
    raise exception 'The item was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  return v_protocol;
end;
$$;

create function private.require_protocol_role(p_protocol_id uuid, p_min public.protocol_role)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.active_user_id() is null or not private.has_protocol_role(p_protocol_id, p_min) then
    raise exception 'You do not have permission to do this.' using errcode = '42501', hint = 'not_allowed';
  end if;
end;
$$;

-- The step and every sub-step beneath it, at any depth.
create function private.step_subtree(p_step_id uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select s.id from public.test_steps s where s.id = p_step_id
    union all
    select c.id from public.test_steps c join tree t on c.parent_step_id = t.id
  )
  select tree.id from tree
$$;

-------------------------------------------------------------------------------
-- Descendant counts (for "archive … and N items beneath it")
-------------------------------------------------------------------------------

create function public.node_counts(p_node_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_protocol uuid := private.node_protocol(p_node_type, p_id);
  v_functions integer := 0;
  v_runs integer := 0;
  v_steps integer := 0;
  v_evidence integer := 0;
begin
  perform private.require_protocol_role(v_protocol, 'viewer');

  case p_node_type
    when 'protocol' then
      select count(*) into v_functions from public.functions where protocol_id = p_id and deleted_at is null;
      select count(*) into v_runs from public.test_runs where protocol_id = p_id and deleted_at is null;
      select count(*) into v_steps from public.test_steps where protocol_id = p_id and deleted_at is null;
      select count(*) into v_evidence from public.evidence_files where protocol_id = p_id and deleted_at is null;
    when 'chapter' then
      select count(*) into v_functions from public.functions where chapter_id = p_id and deleted_at is null;
      select count(*) into v_runs from public.test_runs r join public.functions f on f.id = r.function_id
        where f.chapter_id = p_id and r.deleted_at is null;
      select count(*) into v_steps from public.test_steps s join public.test_runs r on r.id = s.test_run_id
        join public.functions f on f.id = r.function_id where f.chapter_id = p_id and s.deleted_at is null;
      select count(*) into v_evidence from public.evidence_files where chapter_id = p_id and deleted_at is null;
    when 'function' then
      select count(*) into v_runs from public.test_runs where function_id = p_id and deleted_at is null;
      select count(*) into v_steps from public.test_steps s join public.test_runs r on r.id = s.test_run_id
        where r.function_id = p_id and s.deleted_at is null;
      select count(*) into v_evidence from public.evidence_files where function_id = p_id and deleted_at is null;
    when 'test_run' then
      select count(*) into v_steps from public.test_steps where test_run_id = p_id and deleted_at is null;
      select count(*) into v_evidence from public.evidence_files where test_run_id = p_id and deleted_at is null;
    when 'test_step' then
      select count(*) - 1 into v_steps from public.test_steps
        where id in (select id from private.step_subtree(p_id)) and deleted_at is null;
      select count(*) into v_evidence from public.evidence_files
        where test_step_id in (select id from private.step_subtree(p_id)) and deleted_at is null;
    else
      null;
  end case;

  return jsonb_build_object(
    'functions', v_functions,
    'test_runs', v_runs,
    'test_steps', greatest(v_steps, 0),
    'evidence', v_evidence
  );
end;
$$;

-------------------------------------------------------------------------------
-- Reorder (ARCHITECTURE section 4: one RPC, full ordered list, one transaction)
-------------------------------------------------------------------------------

-- p_parent_id: protocol (for chapters), chapter (functions), function
-- (test runs), test run (top-level steps) or step (its sub-steps).
-- p_ordered_ids must list exactly the live siblings. Archived siblings keep
-- their relative order after the live ones.
create function public.reorder_siblings(p_node_type text, p_parent_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_filter text;
  v_protocol uuid;
  v_live uuid[];
begin
  case p_node_type
    when 'chapter' then
      v_table := 'chapters';
      v_filter := format('protocol_id = %L', p_parent_id);
      v_protocol := private.node_protocol('protocol', p_parent_id);
    when 'function' then
      v_table := 'functions';
      v_filter := format('chapter_id = %L', p_parent_id);
      v_protocol := private.node_protocol('chapter', p_parent_id);
    when 'test_run' then
      v_table := 'test_runs';
      v_filter := format('function_id = %L', p_parent_id);
      v_protocol := private.node_protocol('function', p_parent_id);
    when 'test_step' then
      v_table := 'test_steps';
      if exists (select 1 from public.test_steps where id = p_parent_id) then
        v_filter := format('parent_step_id = %L', p_parent_id);
        v_protocol := private.node_protocol('test_step', p_parent_id);
      else
        v_filter := format('test_run_id = %L and parent_step_id is null', p_parent_id);
        v_protocol := private.node_protocol('test_run', p_parent_id);
      end if;
    else
      raise exception 'Unknown item type.' using errcode = '22023', hint = 'invalid_node_type';
  end case;

  perform private.require_protocol_role(v_protocol, 'manager');

  execute format('select coalesce(array_agg(id), ''{}'') from public.%I where %s and deleted_at is null', v_table, v_filter)
    into v_live;

  if coalesce(array_length(p_ordered_ids, 1), 0) <> coalesce(array_length(v_live, 1), 0)
     or (select count(distinct x) from unnest(p_ordered_ids) as x) <> coalesce(array_length(p_ordered_ids, 1), 0)
     or not (p_ordered_ids <@ v_live and v_live <@ p_ordered_ids) then
    raise exception 'The list has changed since you opened it. Reload and try again.' using errcode = 'P0001', hint = 'stale_order';
  end if;

  execute format(
    'update public.%I t set position = o.ordinality
       from unnest($1) with ordinality as o(id, ordinality)
      where t.id = o.id and t.position is distinct from o.ordinality',
    v_table
  ) using p_ordered_ids;

  execute format(
    'update public.%I t set position = a.new_position
       from (select id, %s + row_number() over (order by position, created_at) as new_position
               from public.%I where %s and deleted_at is not null) a
      where t.id = a.id and t.position is distinct from a.new_position',
    v_table, coalesce(array_length(p_ordered_ids, 1), 0), v_table, v_filter
  );
end;
$$;

-------------------------------------------------------------------------------
-- Archive and restore (ADR-008)
-------------------------------------------------------------------------------

-- Marks the node and every live descendant (including evidence) with one
-- timestamp, so restore_node can undo exactly this operation. Returns the
-- number of rows archived.
create function public.archive_node(p_node_type text, p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protocol uuid := private.node_protocol(p_node_type, p_id);
  v_user uuid := private.active_user_id();
  v_now timestamptz := now();
  v_total integer := 0;
  v_rows integer;
begin
  if p_node_type = 'protocol' then
    if v_user is null or not private.is_admin() then
      raise exception 'Only an administrator can archive a protocol.' using errcode = '42501', hint = 'not_allowed';
    end if;
  else
    perform private.require_protocol_role(v_protocol, 'manager');
  end if;

  case p_node_type
    when 'protocol' then
      update public.protocols set deleted_at = v_now, deleted_by = v_user where id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_rows;
    when 'chapter' then
      update public.chapters set deleted_at = v_now, deleted_by = v_user where id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_rows;
      update public.functions set deleted_at = v_now, deleted_by = v_user where chapter_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_runs r set deleted_at = v_now, deleted_by = v_user
        from public.functions f where f.id = r.function_id and f.chapter_id = p_id and r.deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_steps s set deleted_at = v_now, deleted_by = v_user
        from public.test_runs r join public.functions f on f.id = r.function_id
        where r.id = s.test_run_id and f.chapter_id = p_id and s.deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = v_now, deleted_by = v_user where chapter_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'function' then
      update public.functions set deleted_at = v_now, deleted_by = v_user where id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_rows;
      update public.test_runs set deleted_at = v_now, deleted_by = v_user where function_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_steps s set deleted_at = v_now, deleted_by = v_user
        from public.test_runs r where r.id = s.test_run_id and r.function_id = p_id and s.deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = v_now, deleted_by = v_user where function_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'test_run' then
      update public.test_runs set deleted_at = v_now, deleted_by = v_user where id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_rows;
      update public.test_steps set deleted_at = v_now, deleted_by = v_user where test_run_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = v_now, deleted_by = v_user where test_run_id = p_id and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'test_step' then
      update public.test_steps set deleted_at = v_now, deleted_by = v_user
        where id in (select id from private.step_subtree(p_id)) and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_rows;
      update public.evidence_files set deleted_at = v_now, deleted_by = v_user
        where test_step_id in (select id from private.step_subtree(p_id)) and deleted_at is null;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'evidence' then
      update public.evidence_files set deleted_at = v_now, deleted_by = v_user where id = p_id and deleted_at is null;
      get diagnostics v_total = row_count;
  end case;

  if v_total = 0 then
    raise exception 'This item is already archived.' using errcode = 'P0001', hint = 'already_archived';
  end if;
  return v_total;
end;
$$;

-- Administrators only. Restores the node and the descendants archived in the
-- same operation (same timestamp); items archived separately stay archived.
create function public.restore_node(p_node_type text, p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts timestamptz;
  v_parent_archived boolean := false;
  v_total integer := 0;
  v_rows integer;
begin
  perform private.node_protocol(p_node_type, p_id);
  if private.active_user_id() is null or not private.is_admin() then
    raise exception 'Only an administrator can restore archived items.' using errcode = '42501', hint = 'not_allowed';
  end if;

  case p_node_type
    when 'protocol' then
      select deleted_at into v_ts from public.protocols where id = p_id;
    when 'chapter' then
      select c.deleted_at, p.deleted_at is not null into v_ts, v_parent_archived
        from public.chapters c join public.protocols p on p.id = c.protocol_id where c.id = p_id;
    when 'function' then
      select f.deleted_at, c.deleted_at is not null into v_ts, v_parent_archived
        from public.functions f join public.chapters c on c.id = f.chapter_id where f.id = p_id;
    when 'test_run' then
      select r.deleted_at, f.deleted_at is not null into v_ts, v_parent_archived
        from public.test_runs r join public.functions f on f.id = r.function_id where r.id = p_id;
    when 'test_step' then
      select s.deleted_at, coalesce(ps.deleted_at, r.deleted_at) is not null into v_ts, v_parent_archived
        from public.test_steps s
        join public.test_runs r on r.id = s.test_run_id
        left join public.test_steps ps on ps.id = s.parent_step_id
        where s.id = p_id;
    when 'evidence' then
      select e.deleted_at, coalesce(st.deleted_at, r.deleted_at) is not null into v_ts, v_parent_archived
        from public.evidence_files e
        join public.test_runs r on r.id = e.test_run_id
        left join public.test_steps st on st.id = e.test_step_id
        where e.id = p_id;
  end case;

  if v_ts is null then
    raise exception 'This item is not archived.' using errcode = 'P0001', hint = 'not_archived';
  end if;
  if v_parent_archived then
    raise exception 'The parent item is archived. Restore it first.' using errcode = 'P0001', hint = 'parent_archived';
  end if;

  case p_node_type
    when 'protocol' then
      update public.protocols set deleted_at = null, deleted_by = null where id = p_id;
      get diagnostics v_total = row_count;
    when 'chapter' then
      update public.chapters set deleted_at = null, deleted_by = null where id = p_id;
      get diagnostics v_total = row_count;
      update public.functions set deleted_at = null, deleted_by = null where chapter_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_runs r set deleted_at = null, deleted_by = null
        from public.functions f where f.id = r.function_id and f.chapter_id = p_id and r.deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_steps s set deleted_at = null, deleted_by = null
        from public.test_runs r join public.functions f on f.id = r.function_id
        where r.id = s.test_run_id and f.chapter_id = p_id and s.deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = null, deleted_by = null where chapter_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'function' then
      update public.functions set deleted_at = null, deleted_by = null where id = p_id;
      get diagnostics v_total = row_count;
      update public.test_runs set deleted_at = null, deleted_by = null where function_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.test_steps s set deleted_at = null, deleted_by = null
        from public.test_runs r where r.id = s.test_run_id and r.function_id = p_id and s.deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = null, deleted_by = null where function_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'test_run' then
      update public.test_runs set deleted_at = null, deleted_by = null where id = p_id;
      get diagnostics v_total = row_count;
      update public.test_steps set deleted_at = null, deleted_by = null where test_run_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      update public.evidence_files set deleted_at = null, deleted_by = null where test_run_id = p_id and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'test_step' then
      update public.test_steps set deleted_at = null, deleted_by = null
        where id in (select id from private.step_subtree(p_id)) and deleted_at = v_ts;
      get diagnostics v_total = row_count;
      update public.evidence_files set deleted_at = null, deleted_by = null
        where test_step_id in (select id from private.step_subtree(p_id)) and deleted_at = v_ts;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    when 'evidence' then
      update public.evidence_files set deleted_at = null, deleted_by = null where id = p_id;
      get diagnostics v_total = row_count;
  end case;

  return v_total;
end;
$$;

-------------------------------------------------------------------------------
-- Duplicate (structure only: results reset, no evidence copied)
-------------------------------------------------------------------------------

create function private.copy_steps(p_source_run uuid, p_target_run uuid, p_protocol uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map jsonb := '{}'::jsonb;
  v_new uuid;
  r record;
begin
  for r in
    with recursive tree as (
      select s.id, s.parent_step_id, s.reference, s.description, s.expected_result, s.position, 0 as depth
      from public.test_steps s
      where s.test_run_id = p_source_run and s.parent_step_id is null and s.deleted_at is null
      union all
      select c.id, c.parent_step_id, c.reference, c.description, c.expected_result, c.position, t.depth + 1
      from public.test_steps c join tree t on c.parent_step_id = t.id
      where c.deleted_at is null
    )
    select * from tree order by depth, position
  loop
    insert into public.test_steps (protocol_id, test_run_id, parent_step_id, reference, description, expected_result, position)
    values (
      p_protocol,
      p_target_run,
      case when r.parent_step_id is null then null else (v_map ->> r.parent_step_id::text)::uuid end,
      r.reference,
      r.description,
      r.expected_result,
      r.position
    )
    returning id into v_new;
    v_map := v_map || jsonb_build_object(r.id::text, v_new);
  end loop;
end;
$$;

create function private.copy_test_run(p_source uuid, p_target_function uuid, p_position integer, p_suffix text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_protocol uuid;
begin
  insert into public.test_runs (protocol_id, function_id, reference, title, description, position)
  select r.protocol_id, p_target_function, r.reference, left(r.title || p_suffix, 200), r.description, p_position
  from public.test_runs r where r.id = p_source
  returning id, protocol_id into v_new, v_protocol;
  perform private.copy_steps(p_source, v_new, v_protocol);
  return v_new;
end;
$$;

create function private.copy_function(p_source uuid, p_target_chapter uuid, p_position integer, p_suffix text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  r record;
begin
  insert into public.functions (protocol_id, chapter_id, title, description, position)
  select f.protocol_id, p_target_chapter, left(f.title || p_suffix, 200), f.description, p_position
  from public.functions f where f.id = p_source
  returning id into v_new;
  for r in select id, position from public.test_runs where function_id = p_source and deleted_at is null order by position loop
    perform private.copy_test_run(r.id, v_new, r.position, '');
  end loop;
  return v_new;
end;
$$;

-- Deep-copies a chapter, function or test run with everything beneath it,
-- directly after the source. Returns the new node's id.
create function public.duplicate_node(p_node_type text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protocol uuid := private.node_protocol(p_node_type, p_id);
  v_position integer;
  v_parent uuid;
  v_deleted timestamptz;
  v_new uuid;
  r record;
begin
  perform private.require_protocol_role(v_protocol, 'manager');

  case p_node_type
    when 'chapter' then
      select position, deleted_at into v_position, v_deleted from public.chapters where id = p_id;
      if v_deleted is not null then raise exception 'Archived items cannot be duplicated.' using errcode = 'P0001', hint = 'archived'; end if;
      update public.chapters set position = position + 1 where protocol_id = v_protocol and position > v_position;
      insert into public.chapters (protocol_id, title, description, position)
      select protocol_id, left(title || ' (copy)', 200), description, v_position + 1 from public.chapters where id = p_id
      returning id into v_new;
      for r in select id, position from public.functions where chapter_id = p_id and deleted_at is null order by position loop
        perform private.copy_function(r.id, v_new, r.position, '');
      end loop;
    when 'function' then
      select position, chapter_id, deleted_at into v_position, v_parent, v_deleted from public.functions where id = p_id;
      if v_deleted is not null then raise exception 'Archived items cannot be duplicated.' using errcode = 'P0001', hint = 'archived'; end if;
      update public.functions set position = position + 1 where chapter_id = v_parent and position > v_position;
      v_new := private.copy_function(p_id, v_parent, v_position + 1, ' (copy)');
    when 'test_run' then
      select position, function_id, deleted_at into v_position, v_parent, v_deleted from public.test_runs where id = p_id;
      if v_deleted is not null then raise exception 'Archived items cannot be duplicated.' using errcode = 'P0001', hint = 'archived'; end if;
      update public.test_runs set position = position + 1 where function_id = v_parent and position > v_position;
      v_new := private.copy_test_run(p_id, v_parent, v_position + 1, ' (copy)');
    else
      raise exception 'Only chapters, functions and test runs can be duplicated.' using errcode = '22023', hint = 'invalid_node_type';
  end case;

  perform private.write_audit(p_node_type || '.duplicated', p_node_type, v_new::text, v_protocol, jsonb_build_object('source_id', p_id));
  return v_new;
end;
$$;

-------------------------------------------------------------------------------
-- Grants
-------------------------------------------------------------------------------

grant execute on function
  public.node_counts(text, uuid),
  public.reorder_siblings(text, uuid, uuid[]),
  public.archive_node(text, uuid),
  public.restore_node(text, uuid),
  public.duplicate_node(text, uuid)
to authenticated;
