-- Report exports (ADR-006): the selection is a draft; generating it is
-- recorded server-side; a generated export is read-only.

create function private.require_draft_export(p_export_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export record;
begin
  select protocol_id, status, deleted_at into v_export from public.document_exports where id = p_export_id;
  if not found then
    raise exception 'The report was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.require_protocol_role(v_export.protocol_id, 'manager');
  if v_export.status <> 'draft' or v_export.deleted_at is not null then
    raise exception 'A generated report cannot be changed.' using errcode = 'P0001', hint = 'export_generated';
  end if;
  return v_export.protocol_id;
end;
$$;

-- Images selected in this export whose evidence and place in the hierarchy are still live.
create function private.export_live_image_count(p_export_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.document_export_items i
  join public.evidence_files e on e.id = i.evidence_id and e.deleted_at is null
  join public.test_runs r on r.id = e.test_run_id and r.deleted_at is null
  left join public.test_steps s on s.id = e.test_step_id
  where i.export_id = p_export_id
    and (e.test_step_id is null or s.deleted_at is null)
$$;

-- Sets the order of the given selected images (one step's, or the run-level
-- group's) in one transaction.
create function public.reorder_export_items(p_export_id uuid, p_evidence_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_draft_export(p_export_id);
  if (select count(*) from public.document_export_items where export_id = p_export_id and evidence_id = any(p_evidence_ids))
     <> coalesce(array_length(p_evidence_ids, 1), 0) then
    raise exception 'The selection changed since you opened it. Reload and try again.' using errcode = 'P0001', hint = 'stale_order';
  end if;
  update public.document_export_items i set position = o.ordinality
  from unnest(p_evidence_ids) with ordinality as o(evidence_id, ordinality)
  where i.export_id = p_export_id and i.evidence_id = o.evidence_id and i.position is distinct from o.ordinality;
end;
$$;

-- Records that the browser generated this export (ADR-005, ADR-006). The
-- server stamps who and when; the image count is checked against the stored
-- selection; a saved file must sit at its fixed path in the exports bucket.
create function public.finalize_export(
  p_export_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_file_size_bytes bigint,
  p_chapter_count integer,
  p_test_run_count integer,
  p_step_count integer,
  p_image_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protocol uuid := private.require_draft_export(p_export_id);
begin
  if p_image_count is distinct from private.export_live_image_count(p_export_id) then
    raise exception 'The selection changed while the report was being generated. Generate it again.' using errcode = 'P0001', hint = 'selection_changed';
  end if;
  if p_storage_path is not null then
    if p_storage_path <> v_protocol::text || '/' || p_export_id::text || '.docx' then
      raise exception 'The report file is not at its expected location.' using errcode = 'P0001', hint = 'invalid_path';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'exports' and o.name = p_storage_path) then
      raise exception 'The report file was not found in storage.' using errcode = 'P0001', hint = 'upload_missing';
    end if;
  end if;

  update public.document_exports
  set status = 'generated',
      generated_by = (select auth.uid()),
      generated_at = now(),
      storage_path = p_storage_path,
      sha256 = p_sha256,
      file_size_bytes = p_file_size_bytes,
      chapter_count = p_chapter_count,
      test_run_count = p_test_run_count,
      step_count = p_step_count,
      image_count = p_image_count
  where id = p_export_id;
end;
$$;

-- A new draft with the same settings and the still-live selection, so work
-- can continue after a report was generated.
create function public.copy_export_to_draft(p_export_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_new uuid;
begin
  select protocol_id, include_steps_without_evidence into v_source from public.document_exports where id = p_export_id;
  if not found then
    raise exception 'The report was not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.require_protocol_role(v_source.protocol_id, 'manager');

  insert into public.document_exports (protocol_id, name, include_steps_without_evidence)
  values (v_source.protocol_id, left(btrim(p_name), 200), v_source.include_steps_without_evidence)
  returning id into v_new;

  insert into public.document_export_items (export_id, protocol_id, evidence_id, position, caption_override)
  select v_new, i.protocol_id, i.evidence_id, i.position, i.caption_override
  from public.document_export_items i
  join public.evidence_files e on e.id = i.evidence_id and e.deleted_at is null
  where i.export_id = p_export_id;

  return v_new;
end;
$$;

grant execute on function
  public.reorder_export_items(uuid, uuid[]),
  public.finalize_export(uuid, text, text, bigint, integer, integer, integer, integer),
  public.copy_export_to_draft(uuid, text)
to authenticated;
