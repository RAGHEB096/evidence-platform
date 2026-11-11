-- Recording step results and registering evidence (ADR-004).

-------------------------------------------------------------------------------
-- Role checks for a given user (server code acting for that user)
-------------------------------------------------------------------------------

create function private.user_has_protocol_role(p_user uuid, p_protocol uuid, p_min public.protocol_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles u
    where u.id = p_user and u.is_active and not u.must_change_password
      and (
        u.is_admin
        or exists (
          select 1
          from public.protocol_access a
          join public.protocols pr on pr.id = a.protocol_id and pr.deleted_at is null
          where a.user_id = u.id and a.protocol_id = p_protocol and a.role >= p_min
        )
      )
  )
$$;

-------------------------------------------------------------------------------
-- Step results (testers and above; the only way to write execution fields)
-------------------------------------------------------------------------------

create function public.record_step_result(
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

  -- Saving unchanged values records nothing.
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
grant execute on function public.record_step_result(uuid, text, public.step_status, text) to authenticated;

-------------------------------------------------------------------------------
-- Evidence registration (called only by finalize-evidence, ADR-013)
-------------------------------------------------------------------------------

create function public.svc_check_protocol_role(p_actor uuid, p_protocol uuid, p_min public.protocol_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_protocol_role(p_actor, p_protocol, p_min)
$$;

-- What the function needs to know about an uploaded object before touching it.
create function public.svc_evidence_object(p_path text)
returns table (owner_id text, size_bytes bigint, mime_type text, registered boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.owner_id,
         (o.metadata ->> 'size')::bigint,
         o.metadata ->> 'mimetype',
         exists (select 1 from public.evidence_files e where e.storage_path = o.name)
  from storage.objects o
  where o.bucket_id = 'evidence' and o.name = p_path
$$;

create function public.svc_register_evidence(
  p_actor uuid,
  p_id uuid,
  p_test_run_id uuid,
  p_test_step_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_step record;
begin
  select r.protocol_id, r.function_id, f.chapter_id, r.deleted_at into v_run
  from public.test_runs r join public.functions f on f.id = r.function_id
  where r.id = p_test_run_id;
  if not found then
    raise exception 'The test run was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if not private.user_has_protocol_role(p_actor, v_run.protocol_id, 'tester') then
    raise exception 'You do not have permission to do this.' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_run.deleted_at is not null then
    raise exception 'Archived items cannot be changed.' using errcode = 'P0001', hint = 'archived';
  end if;

  if p_test_step_id is not null then
    select s.test_run_id, s.deleted_at into v_step from public.test_steps s where s.id = p_test_step_id;
    if not found or v_step.test_run_id <> p_test_run_id then
      raise exception 'The step does not belong to this test run.' using errcode = 'P0001', hint = 'step_mismatch';
    end if;
    if v_step.deleted_at is not null then
      raise exception 'Archived items cannot be changed.' using errcode = 'P0001', hint = 'archived';
    end if;
  end if;

  perform private.set_actor(p_actor);

  insert into public.evidence_files (
    id, protocol_id, chapter_id, function_id, test_run_id, test_step_id, storage_path,
    original_filename, mime_type, size_bytes, sha256, width, height, caption, uploaded_by
  ) values (
    p_id, v_run.protocol_id, v_run.chapter_id, v_run.function_id, p_test_run_id, p_test_step_id, p_storage_path,
    p_original_filename, p_mime_type, p_size_bytes, p_sha256, p_width, p_height, coalesce(p_caption, ''), p_actor
  );
  return p_id;
end;
$$;

revoke execute on function
  public.svc_check_protocol_role(uuid, uuid, public.protocol_role),
  public.svc_evidence_object(text),
  public.svc_register_evidence(uuid, uuid, uuid, uuid, text, text, text, bigint, text, integer, integer, text)
from public, anon, authenticated;
grant execute on function
  public.svc_check_protocol_role(uuid, uuid, public.protocol_role),
  public.svc_evidence_object(text),
  public.svc_register_evidence(uuid, uuid, uuid, uuid, text, text, text, bigint, text, integer, integer, text)
to service_role;
