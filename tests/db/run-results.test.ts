import { beforeAll, describe, expect, it } from 'vitest'
import { sql } from './helpers'
import { buildWorld, type World } from './world'

let w: World
let loneRun: string

beforeAll(async () => {
  w = await buildWorld()
  const { data } = await w.manager.client
    .from('test_runs')
    .insert({ protocol_id: w.p.protocolId, function_id: w.p.functionId, title: 'No steps', expected_result: 'The label is legible.' })
    .select('id')
    .single()
  loneRun = (data as { id: string }).id
})

const record = (as: World['tester']['client'], runId: string, status: string, actual = 'Legible') =>
  as.rpc('record_test_run_result', { p_test_run_id: runId, p_actual_result: actual, p_status: status, p_comments: '' })

describe('results on a test run without steps (ADR-018)', () => {
  it('lets testers record them, stamped and audited', async () => {
    expect((await record(w.tester.client, loneRun, 'passed')).error).toBeNull()
    const { data } = await w.viewer.client.from('test_runs').select('expected_result, actual_result, status, executed_by').eq('id', loneRun).single()
    expect(data).toEqual({ expected_result: 'The label is legible.', actual_result: 'Legible', status: 'passed', executed_by: w.tester.id })
    const [event] = await sql<{ actor_id: string }>(`select actor_id from public.audit_events where event_type = 'test_run.result_recorded' and entity_id = $1`, [loneRun])
    expect(event!.actor_id).toBe(w.tester.id)
  })

  it('refuses viewers and outsiders, and direct writes of execution fields', async () => {
    expect((await record(w.viewer.client, loneRun, 'failed')).error?.code).toBe('42501')
    expect((await record(w.outsider.client, loneRun, 'failed')).error?.code).toBe('42501')
    expect((await w.manager.client.from('test_runs').update({ status: 'failed' }).eq('id', loneRun)).error?.code).toBe('42501')
  })

  it('keeps the status of a run with steps derived from them', async () => {
    expect((await record(w.tester.client, w.p.testRunId, 'passed')).error?.hint).toBe('status_derived')
  })

  it('stays open when the protocol is released, while its expected result is locked', async () => {
    await w.manager.client.from('protocols').update({ status: 'released' }).eq('id', w.p.protocolId)
    try {
      expect((await record(w.tester.client, loneRun, 'failed', 'Smudged')).error).toBeNull()
      expect((await w.manager.client.from('test_runs').update({ expected_result: 'Changed' }).eq('id', loneRun)).error?.hint).toBe('protocol_locked')
      expect((await w.manager.client.from('protocols').update({ chapter_start: 5 }).eq('id', w.p.protocolId)).error?.hint).toBe('protocol_locked')
    } finally {
      await w.manager.client.from('protocols').update({ status: 'draft' }).eq('id', w.p.protocolId)
    }
  })

  it('counts toward dashboard progress', async () => {
    const { data } = await w.tester.client.rpc('protocol_overview')
    const row = (data as { id: string; steps: number; steps_executed: number }[]).find((r) => r.id === w.p.protocolId)!
    // One leaf step (the sub-step) plus the run without steps.
    expect(Number(row.steps)).toBe(2)
    expect(Number(row.steps_executed)).toBe(1)
  })

  it('lets managers set the first chapter number while the protocol is a draft', async () => {
    const { data } = await w.manager.client.from('protocols').update({ chapter_start: 11 }).eq('id', w.p.protocolId).select('chapter_start')
    expect(data).toEqual([{ chapter_start: 11 }])
    expect((await w.tester.client.from('protocols').update({ chapter_start: 2 }).eq('id', w.p.protocolId).select('id')).data ?? []).toEqual([])
  })
})
