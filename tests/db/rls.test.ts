import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { insertEvidence, sql } from './helpers'
import { buildWorld, type World } from './world'

let w: World

beforeAll(async () => {
  w = await buildWorld()
})

const DOMAIN_TABLES = [
  'protocols',
  'protocol_access',
  'chapters',
  'functions',
  'test_runs',
  'test_steps',
  'evidence_files',
  'document_exports',
  'document_export_items',
  'audit_events',
] as const

async function count(client: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await client.from(table).select('*').eq(column, value)
  if (error) throw new Error(`${table}: ${error.message}`)
  return data.length
}

describe('an unassigned user', () => {
  it('reads nothing of a protocol from any table', async () => {
    const { client } = w.outsider
    for (const table of DOMAIN_TABLES) {
      const column = table === 'protocols' ? 'id' : 'protocol_id'
      expect(await count(client, table, column, w.p.protocolId), table).toBe(0)
    }
    // Nor anything at all, for good measure.
    for (const table of DOMAIN_TABLES) {
      const { data } = await client.from(table).select('*')
      expect(data, table).toEqual([])
    }
  })

  it('sees only their own profile', async () => {
    const { data } = await w.outsider.client.from('user_profiles').select('id')
    expect(data).toEqual([{ id: w.outsider.id }])
  })

  it('cannot write to the protocol or create one', async () => {
    const { client } = w.outsider
    expect((await client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'x' })).error).not.toBeNull()
    const { data } = await client.from('protocols').update({ name: 'hijacked' }).eq('id', w.p.protocolId).select('id')
    expect(data ?? []).toEqual([])
    const { error } = await client.rpc('create_protocol', { p_reference: 'NOPE-1', p_name: 'No' })
    expect(error?.code).toBe('42501')
  })

  it('cannot grant themselves access', async () => {
    const { error } = await w.outsider.client
      .from('protocol_access')
      .insert({ protocol_id: w.p.protocolId, user_id: w.outsider.id, role: 'manager' })
    expect(error).not.toBeNull()
  })
})

describe('viewer', () => {
  it('reads the protocol, its structure and evidence', async () => {
    const { client } = w.viewer
    expect(await count(client, 'protocols', 'id', w.p.protocolId)).toBe(1)
    expect(await count(client, 'chapters', 'protocol_id', w.p.protocolId)).toBe(1)
    expect(await count(client, 'test_steps', 'protocol_id', w.p.protocolId)).toBe(2)
    expect(await count(client, 'evidence_files', 'protocol_id', w.p.protocolId)).toBe(1)
  })

  it('reads nothing of another protocol', async () => {
    expect(await count(w.viewer.client, 'protocols', 'id', w.q.protocolId)).toBe(0)
    expect(await count(w.viewer.client, 'chapters', 'protocol_id', w.q.protocolId)).toBe(0)
  })

  it('cannot change structure, results, evidence or protocol details', async () => {
    const { client } = w.viewer
    expect((await client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'x' })).error).not.toBeNull()
    const steps = await client.from('test_steps').update({ description: 'changed' }).eq('id', w.p.stepId).select('id')
    expect(steps.data ?? []).toEqual([])
    const ev = await client.from('evidence_files').update({ caption: 'changed' }).eq('id', w.evidenceP.id).select('id')
    expect(ev.data ?? []).toEqual([])
    const pr = await client.from('protocols').update({ name: 'changed' }).eq('id', w.p.protocolId).select('id')
    expect(pr.data ?? []).toEqual([])
    expect((await client.from('document_exports').insert({ protocol_id: w.p.protocolId, name: 'r' })).error).not.toBeNull()
  })
})

describe('tester', () => {
  it('cannot edit structure or protocol details', async () => {
    const { client } = w.tester
    expect((await client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'x' })).error).not.toBeNull()
    const steps = await client.from('test_steps').update({ expected_result: 'changed' }).eq('id', w.p.stepId).select('id')
    expect(steps.data ?? []).toEqual([])
    const pr = await client.from('protocols').update({ name: 'changed' }).eq('id', w.p.protocolId).select('id')
    expect(pr.data ?? []).toEqual([])
  })

  it('cannot write execution fields directly (they go through record_step_result)', async () => {
    const { error } = await w.tester.client.from('test_steps').update({ status: 'passed' }).eq('id', w.p.stepId)
    expect(error?.code).toBe('42501')
  })

  it('edits caption and description of their own upload only', async () => {
    const own = await w.tester.client
      .from('evidence_files')
      .update({ caption: 'Login page', description: 'After step 1' })
      .eq('id', w.evidenceP.id)
      .select('caption')
    expect(own.data).toEqual([{ caption: 'Login page' }])

    const managers = await insertEvidence(w.p, w.manager.id)
    const other = await w.tester.client.from('evidence_files').update({ caption: 'Not mine' }).eq('id', managers.id).select('id')
    expect(other.data ?? []).toEqual([])
    const [row] = await sql<{ caption: string }>('select caption from public.evidence_files where id = $1', [managers.id])
    expect(row!.caption).toBe('')
  })

  it('cannot change hash, path, uploader or archive state of evidence', async () => {
    for (const patch of [
      { sha256: 'c'.repeat(64) },
      { storage_path: 'x' },
      { uploaded_by: w.tester.id },
      { deleted_at: new Date().toISOString() },
    ]) {
      const { error } = await w.tester.client.from('evidence_files').update(patch).eq('id', w.evidenceP.id)
      expect(error?.code, JSON.stringify(patch)).toBe('42501')
    }
  })

  it('cannot create evidence rows directly', async () => {
    const { error } = await w.tester.client.from('evidence_files').insert({
      id: crypto.randomUUID(),
      protocol_id: w.p.protocolId,
    })
    expect(error).not.toBeNull()
  })
})

describe('manager', () => {
  it('adds, edits and nests structure', async () => {
    const { client } = w.manager
    const chapter = await client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'SMT Line 2' }).select('id, position').single()
    expect(chapter.error).toBeNull()
    expect(chapter.data!.position).toBe(2)

    const sub = await client
      .from('test_steps')
      .insert({ protocol_id: w.p.protocolId, test_run_id: w.p.testRunId, parent_step_id: w.p.subStepId, description: 'Deeper' })
      .select('id')
      .single()
    expect(sub.error).toBeNull()

    const renamed = await client.from('protocols').update({ name: 'Protocol P (rev)' }).eq('id', w.p.protocolId).select('name')
    expect(renamed.data).toEqual([{ name: 'Protocol P (rev)' }])
  })

  it('cannot archive, move or reposition rows directly (RPCs only)', async () => {
    const { client } = w.manager
    for (const patch of [{ deleted_at: new Date().toISOString() }, { position: 99 }, { protocol_id: w.q.protocolId }]) {
      const { error } = await client.from('chapters').update(patch).eq('id', w.p.chapterId)
      expect(error?.code, JSON.stringify(patch)).toBe('42501')
    }
  })

  it('cannot attach a node in their protocol to a parent from another protocol', async () => {
    const { error } = await w.manager.client
      .from('functions')
      .insert({ protocol_id: w.p.protocolId, chapter_id: w.q.chapterId, title: 'Smuggled' })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503')
  })

  it('cannot attach a sub-step to a step from another test run', async () => {
    const run2 = await w.manager.client
      .from('test_runs')
      .insert({ protocol_id: w.p.protocolId, function_id: w.p.functionId, title: 'Run 2' })
      .select('id')
      .single()
    const { error } = await w.manager.client
      .from('test_steps')
      .insert({ protocol_id: w.p.protocolId, test_run_id: run2.data!.id, parent_step_id: w.p.stepId, description: 'x' })
    expect(error?.code).toBe('23503')
  })

  it('reads nothing of a protocol they are not assigned to', async () => {
    for (const table of DOMAIN_TABLES) {
      const column = table === 'protocols' ? 'id' : 'protocol_id'
      expect(await count(w.manager.client, table, column, w.q.protocolId), table).toBe(0)
    }
  })

  it('cannot assign access (administrators only)', async () => {
    const { error } = await w.manager.client
      .from('protocol_access')
      .insert({ protocol_id: w.p.protocolId, user_id: w.outsider.id, role: 'viewer' })
    expect(error).not.toBeNull()
  })

  it('sees the team on their protocol', async () => {
    expect(await count(w.manager.client, 'protocol_access', 'protocol_id', w.p.protocolId)).toBe(3)
  })

  it('edits any evidence metadata in their protocol and builds draft exports', async () => {
    const ev = await w.manager.client.from('evidence_files').update({ caption: 'By manager' }).eq('id', w.evidenceP.id).select('id')
    expect(ev.data).toHaveLength(1)
    const draft = await w.manager.client.from('document_exports').insert({ protocol_id: w.p.protocolId, name: 'Report' }).select('id').single()
    expect(draft.error).toBeNull()
    const item = await w.manager.client
      .from('document_export_items')
      .insert({ export_id: draft.data!.id, protocol_id: w.p.protocolId, evidence_id: w.evidenceP.id })
      .select('id')
    expect(item.error).toBeNull()
    // Evidence from another protocol cannot be pulled into this export.
    const smuggled = await w.manager.client
      .from('document_export_items')
      .insert({ export_id: draft.data!.id, protocol_id: w.p.protocolId, evidence_id: w.evidenceQ.id })
    expect(smuggled.error).not.toBeNull()
  })

  it('reads audit events for their own protocol only', async () => {
    const own = await w.manager.client.from('audit_events').select('id').eq('protocol_id', w.p.protocolId)
    expect(own.data!.length).toBeGreaterThan(0)
    expect(await count(w.manager.client, 'audit_events', 'protocol_id', w.q.protocolId)).toBe(0)
  })
})

describe('administrator', () => {
  it('reads every protocol and every profile', async () => {
    expect(await count(w.admin.client, 'protocols', 'id', w.p.protocolId)).toBe(1)
    expect(await count(w.admin.client, 'protocols', 'id', w.q.protocolId)).toBe(1)
    const { data } = await w.admin.client.from('user_profiles').select('id')
    expect(data!.length).toBeGreaterThanOrEqual(6)
  })

  it('changes and removes access', async () => {
    const changed = await w.admin.client
      .from('protocol_access')
      .update({ role: 'tester' })
      .eq('protocol_id', w.p.protocolId)
      .eq('user_id', w.viewer.id)
      .select('role')
    expect(changed.data).toEqual([{ role: 'tester' }])
    await w.admin.client.from('protocol_access').update({ role: 'viewer' }).eq('protocol_id', w.p.protocolId).eq('user_id', w.viewer.id)
  })
})

describe('settings', () => {
  it('are readable by active users and changeable only by administrators', async () => {
    expect((await w.viewer.client.from('app_settings').select('key')).data).toHaveLength(3)
    const denied = await w.manager.client.from('app_settings').update({ value: 1048576 }).eq('key', 'upload_limit_bytes').select('key')
    expect(denied.data ?? []).toEqual([])
    const invalid = await w.admin.client.from('app_settings').update({ value: 1 }).eq('key', 'upload_limit_bytes')
    expect(invalid.error?.code).toBe('23514')
  })
})
