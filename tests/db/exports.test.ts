import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { insertEvidence, sql } from './helpers'
import { buildWorld, type World } from './world'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
let w: World

beforeAll(async () => {
  w = await buildWorld()
})

async function draftWith(as: SupabaseClient, evidenceIds: string[]) {
  const { data, error } = await as.from('document_exports').insert({ protocol_id: w.p.protocolId, name: 'Report' }).select('id').single()
  if (error) throw new Error(error.message)
  const exportId = (data as { id: string }).id
  for (const [index, evidenceId] of evidenceIds.entries()) {
    const { error: itemError } = await as
      .from('document_export_items')
      .insert({ export_id: exportId, protocol_id: w.p.protocolId, evidence_id: evidenceId, position: index + 1 })
    if (itemError) throw new Error(itemError.message)
  }
  return exportId
}

const finalizeArgs = (exportId: string, imageCount: number, storagePath: string | null = null) => ({
  p_export_id: exportId,
  p_storage_path: storagePath,
  p_sha256: 'b'.repeat(64),
  p_file_size_bytes: 1234,
  p_chapter_count: 1,
  p_test_run_count: 1,
  p_step_count: 1,
  p_image_count: imageCount,
})

describe('finalize_export', () => {
  it('records generation server-side, with the file at its fixed path, and makes the export read-only', async () => {
    const second = await insertEvidence(w.p, w.tester.id)
    const exportId = await draftWith(w.manager.client, [w.evidenceP.id, second.id])
    const path = `${w.p.protocolId}/${exportId}.docx`
    expect((await w.manager.client.storage.from('exports').upload(path, Buffer.from('PK\u0003\u0004'), { contentType: DOCX })).error).toBeNull()

    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 2, path))).error).toBeNull()
    const { data } = await w.viewer.client.from('document_exports').select('status, generated_by, generated_at, storage_path, image_count').eq('id', exportId).single()
    expect(data).toMatchObject({ status: 'generated', generated_by: w.manager.id, storage_path: path, image_count: 2 })
    expect(data!.generated_at).not.toBeNull()

    // Read-only from now on, whatever the route.
    expect((await w.manager.client.from('document_exports').update({ name: 'Renamed' }).eq('id', exportId).select('id')).data ?? []).toEqual([])
    const added = await w.manager.client.from('document_export_items').insert({ export_id: exportId, protocol_id: w.p.protocolId, evidence_id: (await insertEvidence(w.p, w.tester.id)).id })
    expect(added.error).not.toBeNull()
    await w.manager.client.from('document_export_items').delete().eq('export_id', exportId)
    const [{ n }] = (await sql<{ n: string }>('select count(*) n from public.document_export_items where export_id = $1', [exportId])) as [{ n: string }]
    expect(Number(n)).toBe(2)
    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 2))).error?.hint).toBe('export_generated')

    const [event] = await sql<{ actor_id: string }>(`select actor_id from public.audit_events where event_type = 'document_export.generated' and entity_id = $1`, [exportId])
    expect(event!.actor_id).toBe(w.manager.id)
  })

  it('refuses a count that does not match the stored live selection', async () => {
    const archived = await insertEvidence(w.p, w.tester.id)
    const exportId = await draftWith(w.manager.client, [w.evidenceP.id, archived.id])
    await w.manager.client.rpc('archive_node', { p_node_type: 'evidence', p_id: archived.id })
    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 2))).error?.hint).toBe('selection_changed')
    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 1))).error).toBeNull()
  })

  it('refuses a file path other than {protocol}/{export}.docx, or a missing file', async () => {
    const exportId = await draftWith(w.manager.client, [w.evidenceP.id])
    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 1, `${w.p.protocolId}/${randomUUID()}.docx`))).error?.hint).toBe('invalid_path')
    expect((await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 1, `${w.p.protocolId}/${exportId}.docx`))).error?.hint).toBe('upload_missing')
  })

  it('is refused below manager', async () => {
    const exportId = await draftWith(w.manager.client, [w.evidenceP.id])
    for (const user of [w.tester, w.viewer, w.outsider]) {
      expect((await user.client.rpc('finalize_export', finalizeArgs(exportId, 1))).error?.code, user.username).toBe('42501')
    }
  })
})

describe('reorder_export_items and copy_export_to_draft', () => {
  it('reorders a group of selected images in one call', async () => {
    const a = await insertEvidence(w.p, w.tester.id)
    const b = await insertEvidence(w.p, w.tester.id)
    const exportId = await draftWith(w.manager.client, [a.id, b.id])
    expect((await w.manager.client.rpc('reorder_export_items', { p_export_id: exportId, p_evidence_ids: [b.id, a.id] })).error).toBeNull()
    const rows = await sql<{ evidence_id: string }>('select evidence_id from public.document_export_items where export_id = $1 order by position', [exportId])
    expect(rows.map((row) => row.evidence_id)).toEqual([b.id, a.id])
    expect((await w.tester.client.rpc('reorder_export_items', { p_export_id: exportId, p_evidence_ids: [a.id, b.id] })).error?.code).toBe('42501')
    expect((await w.manager.client.rpc('reorder_export_items', { p_export_id: exportId, p_evidence_ids: [a.id, randomUUID()] })).error?.hint).toBe('stale_order')
  })

  it('starts a new draft from a generated export, keeping live items and overrides', async () => {
    const keep = await insertEvidence(w.p, w.tester.id)
    const gone = await insertEvidence(w.p, w.tester.id)
    const exportId = await draftWith(w.manager.client, [keep.id, gone.id])
    await w.manager.client.from('document_export_items').update({ caption_override: 'Override' }).eq('export_id', exportId).eq('evidence_id', keep.id)
    await w.manager.client.rpc('finalize_export', finalizeArgs(exportId, 2))
    await w.manager.client.rpc('archive_node', { p_node_type: 'evidence', p_id: gone.id })

    const { data: copyId, error } = await w.manager.client.rpc('copy_export_to_draft', { p_export_id: exportId, p_name: 'Next report' })
    expect(error).toBeNull()
    const { data: items } = await w.manager.client.from('document_export_items').select('evidence_id, caption_override').eq('export_id', copyId)
    expect(items).toEqual([{ evidence_id: keep.id, caption_override: 'Override' }])
    expect((await w.viewer.client.rpc('copy_export_to_draft', { p_export_id: exportId, p_name: 'x' })).error?.code).toBe('42501')
  })
})
