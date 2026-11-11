import { beforeAll, describe, expect, it } from 'vitest'
import { insertEvidence, sql } from './helpers'
import { buildWorld, type World } from './world'

let w: World
let secondChapter: string

beforeAll(async () => {
  w = await buildWorld()
  const { data } = await w.manager.client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'Second' }).select('id').single()
  secondChapter = (data as { id: string }).id
})

const setStatus = (status: 'draft' | 'released' | 'completed') =>
  w.manager.client.from('protocols').update({ status }).eq('id', w.p.protocolId).select('status')

describe('protocol lifecycle: Draft → Released → Completed (ADR-017)', () => {
  it('locks the structure and details once released, but keeps results and evidence open', async () => {
    expect((await setStatus('released')).data).toEqual([{ status: 'released' }])
    const { client } = w.manager

    const attempts = [
      await client.from('chapters').insert({ protocol_id: w.p.protocolId, title: 'Late chapter' }),
      await client.from('chapters').update({ title: 'Renamed' }).eq('id', w.p.chapterId),
      await client.from('test_steps').update({ expected_result: 'Changed' }).eq('id', w.p.stepId),
      await client.from('protocols').update({ name: 'Renamed protocol' }).eq('id', w.p.protocolId),
      await client.rpc('reorder_siblings', { p_node_type: 'chapter', p_parent_id: w.p.protocolId, p_ordered_ids: [secondChapter, w.p.chapterId] }),
      await client.rpc('duplicate_node', { p_node_type: 'chapter', p_id: w.p.chapterId }),
      await client.rpc('archive_node', { p_node_type: 'function', p_id: w.p.functionId }),
    ]
    for (const [index, attempt] of attempts.entries()) expect(attempt.error?.hint, `attempt ${index}`).toBe('protocol_locked')

    // Execution stays open.
    expect((await w.tester.client.rpc('record_step_result', { p_step_id: w.p.subStepId, p_actual_result: 'Logged in.', p_status: 'passed', p_comments: '' })).error).toBeNull()
    const evidence = await insertEvidence(w.p, w.tester.id)
    expect((await w.tester.client.from('evidence_files').update({ caption: 'Still editable' }).eq('id', evidence.id).select('id')).data).toHaveLength(1)
  })

  it('stays locked when completed, and unlocks when set back to draft', async () => {
    expect((await setStatus('completed')).error).toBeNull()
    expect((await w.manager.client.from('chapters').update({ title: 'Renamed' }).eq('id', w.p.chapterId)).error?.hint).toBe('protocol_locked')

    expect((await setStatus('draft')).error).toBeNull()
    expect((await w.manager.client.from('chapters').update({ title: 'Renamed' }).eq('id', w.p.chapterId).select('title')).data).toEqual([{ title: 'Renamed' }])
  })

  it('records every status change with its actor', async () => {
    const events = await sql<{ actor_id: string; metadata: { changes: { status?: { old: string; new: string } } } }>(
      `select actor_id, metadata from public.audit_events
       where entity_type = 'protocol' and entity_id = $1 and metadata -> 'changes' ? 'status' order by id`,
      [w.p.protocolId],
    )
    expect(events.map((event) => [event.actor_id, event.metadata.changes.status])).toEqual([
      [w.manager.id, { old: 'draft', new: 'released' }],
      [w.manager.id, { old: 'released', new: 'completed' }],
      [w.manager.id, { old: 'completed', new: 'draft' }],
    ])
  })

  it('lets only managers change the status', async () => {
    for (const user of [w.tester, w.viewer]) {
      const { data } = await user.client.from('protocols').update({ status: 'released' }).eq('id', w.p.protocolId).select('id')
      expect(data ?? [], user.username).toEqual([])
    }
  })
})

describe('steps with sub-steps', () => {
  it('cannot have their status set directly, but keep result and comments', async () => {
    const changeStatus = await w.tester.client.rpc('record_step_result', { p_step_id: w.p.stepId, p_actual_result: '', p_status: 'failed', p_comments: '' })
    expect(changeStatus.error?.hint).toBe('status_derived')

    const [{ status }] = (await sql<{ status: string }>('select status from public.test_steps where id = $1', [w.p.stepId])) as [{ status: string }]
    const keepStatus = await w.tester.client.rpc('record_step_result', { p_step_id: w.p.stepId, p_actual_result: 'Overall fine', p_status: status, p_comments: 'See sub-steps' })
    expect(keepStatus.error).toBeNull()
  })

  it('can be set directly again once their sub-steps are archived', async () => {
    await w.manager.client.rpc('archive_node', { p_node_type: 'test_step', p_id: w.p.subStepId })
    expect((await w.tester.client.rpc('record_step_result', { p_step_id: w.p.stepId, p_actual_result: 'x', p_status: 'passed', p_comments: '' })).error).toBeNull()
  })
})
