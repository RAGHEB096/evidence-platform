-- Dashboard figures computed on the server under the caller's RLS (SPEC 4.9),
-- administrator storage usage, and users reading their own audit events.

-------------------------------------------------------------------------------
-- Dashboard (security invoker: every count only sees what RLS shows the caller)
-------------------------------------------------------------------------------

create function public.dashboard_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'protocols', (select count(*) from public.protocols where deleted_at is null),
    'assigned_protocols', (
      select count(*) from public.protocol_access a join public.protocols p on p.id = a.protocol_id
      where a.user_id = (select auth.uid()) and p.deleted_at is null
    ),
    'chapters', (select count(*) from public.chapters c join public.protocols p on p.id = c.protocol_id where c.deleted_at is null and p.deleted_at is null),
    'test_runs', (select count(*) from public.test_runs r join public.protocols p on p.id = r.protocol_id where r.deleted_at is null and p.deleted_at is null),
    'evidence_files', (select count(*) from public.evidence_files e join public.protocols p on p.id = e.protocol_id where e.deleted_at is null and p.deleted_at is null),
    'generated_documents', (select count(*) from public.document_exports d join public.protocols p on p.id = d.protocol_id where d.status = 'generated' and d.deleted_at is null and p.deleted_at is null)
  )
$$;

-- One row per visible live protocol. Progress counts steps without live
-- sub-steps (the ones whose status is recorded directly, ADR-017).
create function public.protocol_overview()
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
  with leaf_steps as (
    select s.protocol_id, s.status
    from public.test_steps s
    join public.test_runs r on r.id = s.test_run_id and r.deleted_at is null
    where s.deleted_at is null
      and not exists (select 1 from public.test_steps c where c.parent_step_id = s.id and c.deleted_at is null)
  )
  select
    p.id, p.reference, p.name, p.version, p.status,
    (select count(*) from public.chapters c where c.protocol_id = p.id and c.deleted_at is null),
    (select count(*) from public.test_runs r where r.protocol_id = p.id and r.deleted_at is null),
    (select count(*) from leaf_steps l where l.protocol_id = p.id),
    (select count(*) from leaf_steps l where l.protocol_id = p.id and l.status in ('passed', 'failed', 'blocked', 'not_applicable')),
    (select count(*) from leaf_steps l where l.protocol_id = p.id and l.status = 'passed'),
    p.updated_at
  from public.protocols p
  where p.deleted_at is null
  order by p.updated_at desc
$$;

grant execute on function public.dashboard_totals(), public.protocol_overview() to authenticated;

-------------------------------------------------------------------------------
-- Storage usage (administrators): files are the first free-tier limit hit
-------------------------------------------------------------------------------

create function public.storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.active_user_id() is null or not private.is_admin() then
    raise exception 'Only an administrator can see storage usage.' using errcode = '42501', hint = 'not_admin';
  end if;
  return (
    select jsonb_build_object(
      'evidence_bytes', coalesce(sum((o.metadata ->> 'size')::bigint) filter (where o.bucket_id = 'evidence'), 0),
      'exports_bytes', coalesce(sum((o.metadata ->> 'size')::bigint) filter (where o.bucket_id = 'exports'), 0),
      -- Uploaded but never finalised (ADR-004); see the cleanup query in the README.
      'orphan_bytes', coalesce(sum((o.metadata ->> 'size')::bigint) filter (
        where o.bucket_id = 'evidence' and not exists (select 1 from public.evidence_files e where e.storage_path = o.name)
      ), 0),
      'objects', count(*)
    )
    from storage.objects o
    where o.bucket_id in ('evidence', 'exports')
  );
end;
$$;
grant execute on function public.storage_usage() to authenticated;

-------------------------------------------------------------------------------
-- Everyone may read the audit events of their own actions
-------------------------------------------------------------------------------

create policy "audit: own actions" on public.audit_events
  for select to authenticated
  using (actor_id = (select private.active_user_id()));
