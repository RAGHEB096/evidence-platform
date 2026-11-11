import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildHierarchy, insertEvidence, sql } from './helpers'
import { buildWorld, type World } from './world'

let w: World

beforeAll(async () => {
  w = await buildWorld()
})

async function insert(as: SupabaseClient, table: string, row: Record<string, unknown>) {
  const { data, error } = await as.from(table).insert(row).select('id').single()
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data as { id: string }).id
}

async function positions(table: string, column: string, parent: string) {
  return sql<{ id: string; position: number; deleted: boolean }>(
    `select id, position, deleted_at is not null as deleted from public.${table} where ${column} = $1 order by position`,
    [parent],
  )
}

describe('reorder_siblings', () => {
  it('renumbers chapters in one call and is refused below manager', async () => {
    const extra1 = await insert(w.manager.client, 'chapters', { protocol_id: w.p.protocolId, title: 'Second' })
    const extra2 = await insert(w.manager.client, 'chapters', { protocol_id: w.p.protocolId, title: 'Third' })
    const order = [extra2, w.p.chapterId, extra1]

    expect((await w.tester.client.rpc('reorder_siblings', { p_node_type: 'chapter', p_parent_id: w.p.protocolId, p_ordered_ids: order })).error?.code).toBe('42501')
    expect((await w.outsider.client.rpc('reorder_siblings', { p_node_type: 'chapter', p_parent_id: w.p.protocolId, p_ordered_ids: order })).error?.code).toBe('42501')

    const { error } = await w.manager.client.rpc('reorder_siblings', { p_node_type: 'chapter', p_parent_id: w.p.protocolId, p_ordered_ids: order })
    expect(error).toBeNull()
    const rows = await positions('chapters', 'protocol_id', w.p.protocolId)
    expect(rows.map((row) => row.id)).toEqual(order)
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3])
  })

  it('refuses a list that does not match the live siblings exactly', async () => {
    const live = (await positions('chapters', 'protocol_id', w.p.protocolId)).filter((row) => !row.deleted).map((row) => row.id)
    for (const bad of [live.slice(1), [...live, live[0]!], [...live.slice(1), w.q.chapterId]]) {
      const { error } = await w.manager.client.rpc('reorder_siblings', { p_node_type: 'chapter', p_parent_id: w.p.protocolId, p_ordered_ids: bad })
      expect(error?.hint).toBe('stale_order')
    }
  })

  it('reorders top-level steps of a run and sub-steps of a step separately', async () => {
    const step2 = await insert(w.manager.client, 'test_steps', { protocol_id: w.p.protocolId, test_run_id: w.p.testRunId, description: 'Step two' })
    const sub2 = await insert(w.manager.client, 'test_steps', {
      protocol_id: w.p.protocolId,
      test_run_id: w.p.testRunId,
      parent_step_id: w.p.stepId,
      description: 'Sub two',
    })
    expect((await w.manager.client.rpc('reorder_siblings', { p_node_type: 'test_step', p_parent_id: w.p.testRunId, p_ordered_ids: [step2, w.p.stepId] })).error).toBeNull()
    expect((await w.manager.client.rpc('reorder_siblings', { p_node_type: 'test_step', p_parent_id: w.p.stepId, p_ordered_ids: [sub2, w.p.subStepId] })).error).toBeNull()

    const top = await sql<{ id: string }>(`select id from public.test_steps where test_run_id = $1 and parent_step_id is null order by position`, [w.p.testRunId])
    expect(top.map((row) => row.id)).toEqual([step2, w.p.stepId])
    const subs = await sql<{ id: string }>(`select id from public.test_steps where parent_step_id = $1 order by position`, [w.p.stepId])
    expect(subs.map((row) => row.id)).toEqual([sub2, w.p.subStepId])
  })
})

describe('archive_node and restore_node', () => {
  it('archives a chapter with everything beneath it, including evidence, and restores exactly that', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    const evidence = await insertEvidence(h, w.tester.id)
    const counts = await w.viewer.client.rpc('node_counts', { p_node_type: 'chapter', p_id: h.chapterId })
    expect(counts.data).toEqual({ functions: 1, test_runs: 1, test_steps: 2, evidence: 1 })

    // A step archived earlier, on its own, must stay archived after the chapter is restored.
    const loneStep = await insert(w.manager.client, 'test_steps', { protocol_id: w.p.protocolId, test_run_id: h.testRunId, description: 'Archived alone' })
    expect((await w.manager.client.rpc('archive_node', { p_node_type: 'test_step', p_id: loneStep })).data).toBe(1)

    const archived = await w.manager.client.rpc('archive_node', { p_node_type: 'chapter', p_id: h.chapterId })
    expect(archived.data).toBe(6) // chapter, function, run, step, sub-step, evidence

    // Gone for everyone but administrators; nothing destroyed.
    expect((await w.manager.client.from('chapters').select('id').eq('id', h.chapterId)).data).toEqual([])
    expect((await w.viewer.client.from('evidence_files').select('id').eq('id', evidence.id)).data).toEqual([])
    expect((await w.admin.client.from('chapters').select('id').eq('id', h.chapterId)).data).toHaveLength(1)
    const [{ n }] = (await sql<{ n: string }>('select count(*) as n from public.test_steps where test_run_id = $1', [h.testRunId])) as [{ n: string }]
    expect(Number(n)).toBe(3)

    // Adding beneath an archived parent is refused.
    const { error: addError } = await w.manager.client.from('functions').insert({ protocol_id: w.p.protocolId, chapter_id: h.chapterId, title: 'x' })
    expect(addError).not.toBeNull()

    // Managers cannot restore; administrators can.
    expect((await w.manager.client.rpc('restore_node', { p_node_type: 'chapter', p_id: h.chapterId })).error?.code).toBe('42501')
    expect((await w.admin.client.rpc('restore_node', { p_node_type: 'chapter', p_id: h.chapterId })).data).toBe(6)

    const steps = await sql<{ id: string; deleted: boolean }>(
      'select id, deleted_at is not null as deleted from public.test_steps where test_run_id = $1',
      [h.testRunId],
    )
    expect(steps.find((row) => row.id === loneStep)!.deleted).toBe(true)
    expect(steps.filter((row) => !row.deleted)).toHaveLength(2)
    expect((await w.viewer.client.from('evidence_files').select('id').eq('id', evidence.id)).data).toHaveLength(1)
  })

  it('archives a step with its sub-steps at any depth', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    const deep = await insert(w.manager.client, 'test_steps', {
      protocol_id: w.p.protocolId,
      test_run_id: h.testRunId,
      parent_step_id: h.subStepId,
      description: 'Third level',
    })
    expect((await w.manager.client.rpc('archive_node', { p_node_type: 'test_step', p_id: h.stepId })).data).toBe(3)
    const [row] = await sql<{ deleted: boolean }>('select deleted_at is not null as deleted from public.test_steps where id = $1', [deep])
    expect(row!.deleted).toBe(true)
  })

  it('refuses to restore a child whose parent is still archived', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    await w.manager.client.rpc('archive_node', { p_node_type: 'function', p_id: h.functionId })
    const { error } = await w.admin.client.rpc('restore_node', { p_node_type: 'test_run', p_id: h.testRunId })
    expect(error?.hint).toBe('parent_archived')
  })

  it('lets testers and viewers archive nothing', async () => {
    for (const user of [w.tester, w.viewer, w.outsider]) {
      const { error } = await user.client.rpc('archive_node', { p_node_type: 'chapter', p_id: w.p.chapterId })
      expect(error?.code, user.username).toBe('42501')
    }
  })

  it('reserves archiving a protocol to administrators, and hides it from its team', async () => {
    const h = await buildHierarchy(w.otherManager.client, w.q.protocolId)
    expect((await w.otherManager.client.rpc('archive_node', { p_node_type: 'protocol', p_id: w.q.protocolId })).error?.code).toBe('42501')
    expect((await w.admin.client.rpc('archive_node', { p_node_type: 'protocol', p_id: w.q.protocolId })).data).toBe(1)
    expect((await w.otherManager.client.from('protocols').select('id').eq('id', w.q.protocolId)).data).toEqual([])
    expect((await w.otherManager.client.from('chapters').select('id').eq('id', h.chapterId)).data).toEqual([])
    expect((await w.admin.client.rpc('restore_node', { p_node_type: 'protocol', p_id: w.q.protocolId })).data).toBe(1)
    expect((await w.otherManager.client.from('chapters').select('id').eq('id', h.chapterId)).data).toHaveLength(1)
  })

  it('records archive and restore in the audit trail with the actor', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    await w.manager.client.rpc('archive_node', { p_node_type: 'test_run', p_id: h.testRunId })
    await w.admin.client.rpc('restore_node', { p_node_type: 'test_run', p_id: h.testRunId })
    const events = await sql<{ event_type: string; actor_id: string }>(
      `select event_type, actor_id from public.audit_events where entity_id = $1 and event_type in ('test_run.archived', 'test_run.restored') order by id`,
      [h.testRunId],
    )
    expect(events).toEqual([
      { event_type: 'test_run.archived', actor_id: w.manager.id },
      { event_type: 'test_run.restored', actor_id: w.admin.id },
    ])
  })
})

describe('duplicate_node', () => {
  it('deep-copies a chapter after the source, resetting results and copying no evidence', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    await insertEvidence(h, w.tester.id)
    await sql(`update public.test_steps set status = 'passed', actual_result = 'It worked', executed_by = $2, executed_at = now() where id = $1`, [h.stepId, w.tester.id], w.tester.id)
    const archivedFn = await insert(w.manager.client, 'functions', { protocol_id: w.p.protocolId, chapter_id: h.chapterId, title: 'Old function' })
    await w.manager.client.rpc('archive_node', { p_node_type: 'function', p_id: archivedFn })

    const { data: copyId, error } = await w.manager.client.rpc('duplicate_node', { p_node_type: 'chapter', p_id: h.chapterId })
    expect(error).toBeNull()

    const chapters = await sql<{ id: string; title: string; position: number }>(
      'select id, title, position from public.chapters where protocol_id = $1 and deleted_at is null order by position',
      [w.p.protocolId],
    )
    const sourceIndex = chapters.findIndex((row) => row.id === h.chapterId)
    expect(chapters[sourceIndex + 1]).toMatchObject({ id: copyId, title: 'SMT Line 1 (copy)' })
    expect(new Set(chapters.map((row) => row.position)).size).toBe(chapters.length)

    const copiedFunctions = await sql<{ id: string; title: string }>('select id, title from public.functions where chapter_id = $1', [copyId])
    expect(copiedFunctions.map((row) => row.title)).toEqual(['Barcode Verification'])
    const copiedSteps = await sql<{ id: string; parent_step_id: string | null; status: string; actual_result: string; executed_by: string | null; test_run_id: string }>(
      `select s.id, s.parent_step_id, s.status, s.actual_result, s.executed_by, s.test_run_id
       from public.test_steps s join public.test_runs r on r.id = s.test_run_id where r.function_id = $1`,
      [copiedFunctions[0]!.id],
    )
    expect(copiedSteps).toHaveLength(2)
    expect(copiedSteps.every((row) => row.status === 'not_started' && row.actual_result === '' && row.executed_by === null)).toBe(true)
    const parent = copiedSteps.find((row) => row.parent_step_id === null)!
    const child = copiedSteps.find((row) => row.parent_step_id !== null)!
    expect(child.parent_step_id).toBe(parent.id)
    expect(parent.id).not.toBe(h.stepId)

    const [{ n }] = (await sql<{ n: string }>('select count(*) as n from public.evidence_files where chapter_id = $1', [copyId])) as [{ n: string }]
    expect(Number(n)).toBe(0)

    const [event] = await sql<{ actor_id: string; metadata: { source_id: string } }>(
      `select actor_id, metadata from public.audit_events where event_type = 'chapter.duplicated' and entity_id = $1`,
      [copyId],
    )
    expect(event).toMatchObject({ actor_id: w.manager.id, metadata: { source_id: h.chapterId } })
  })

  it('duplicates a test run into the same function, right after it', async () => {
    const h = await buildHierarchy(w.manager.client, w.p.protocolId)
    const later = await insert(w.manager.client, 'test_runs', { protocol_id: w.p.protocolId, function_id: h.functionId, title: 'Later run' })
    const { data: copyId } = await w.manager.client.rpc('duplicate_node', { p_node_type: 'test_run', p_id: h.testRunId })
    const runs = await sql<{ id: string }>('select id from public.test_runs where function_id = $1 order by position', [h.functionId])
    expect(runs.map((row) => row.id)).toEqual([h.testRunId, copyId, later])
  })

  it('is refused below manager and for steps', async () => {
    expect((await w.tester.client.rpc('duplicate_node', { p_node_type: 'chapter', p_id: w.p.chapterId })).error?.code).toBe('42501')
    expect((await w.manager.client.rpc('duplicate_node', { p_node_type: 'test_step', p_id: w.p.stepId })).error?.hint).toBe('invalid_node_type')
  })
})
