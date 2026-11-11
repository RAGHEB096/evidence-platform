import { beforeAll, describe, expect, it } from 'vitest'
import { anonClient } from './helpers'
import { buildWorld, type World } from './world'

let w: World

beforeAll(async () => {
  w = await buildWorld()
  await w.tester.client.rpc('record_step_result', { p_step_id: w.p.subStepId, p_actual_result: 'OK', p_status: 'passed', p_comments: '' })
})

const totals = async (client: World['admin']['client']) => {
  const { data, error } = await client.rpc('dashboard_totals')
  if (error) throw error
  return data as Record<string, number>
}

describe('dashboard figures respect roles (SPEC 4.9)', () => {
  it('gives an unassigned user zeros everywhere', async () => {
    expect(await totals(w.outsider.client)).toEqual({
      protocols: 0,
      assigned_protocols: 0,
      chapters: 0,
      test_runs: 0,
      evidence_files: 0,
      generated_documents: 0,
    })
    expect((await w.outsider.client.rpc('protocol_overview')).data).toEqual([])
  })

  it('counts only the assigned protocol for its team', async () => {
    const t = await totals(w.tester.client)
    expect(t).toMatchObject({ protocols: 1, assigned_protocols: 1, chapters: 1, test_runs: 1, evidence_files: 1 })
    const { data } = await w.tester.client.rpc('protocol_overview')
    expect(data).toHaveLength(1)
    // Two steps: step 1 has a sub-step, so only the sub-step counts toward progress.
    expect(data![0]).toMatchObject({ id: w.p.protocolId, chapters: 1, test_runs: 1, steps: 1, steps_executed: 1, steps_passed: 1 })
  })

  it('counts everything for administrators, who alone see storage usage', async () => {
    const admin = await totals(w.admin.client)
    const tester = await totals(w.tester.client)
    expect(admin.protocols).toBeGreaterThan(tester.protocols!)
    const usage = await w.admin.client.rpc('storage_usage')
    expect(usage.error).toBeNull()
    expect(usage.data).toHaveProperty('evidence_bytes')
    expect((await w.manager.client.rpc('storage_usage')).error?.code).toBe('42501')
  })

  it('refuses anonymous callers outright', async () => {
    for (const fn of ['dashboard_totals', 'protocol_overview', 'storage_usage', 'create_protocol', 'user_directory']) {
      const { error } = await anonClient().rpc(fn)
      expect(error, fn).not.toBeNull()
    }
    expect((await anonClient().rpc('needs_setup')).error).toBeNull()
  })
})
