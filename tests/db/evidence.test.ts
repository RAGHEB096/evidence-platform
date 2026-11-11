import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createUser, grantAccess, local, serviceClient, sql, type TestUser } from './helpers'
import { buildWorld, type World } from './world'

const PNG = readFileSync('tests/fixtures/images/screenshot.png')
const JPG = readFileSync('tests/fixtures/images/screenshot.jpg')

let w: World
let tester2: TestUser

beforeAll(async () => {
  w = await buildWorld()
  tester2 = await createUser({ prefix: 'tester2' })
  await grantAccess(w.admin.client, w.p.protocolId, tester2.id, 'tester')
})

async function upload(as: SupabaseClient, bytes: Buffer, fileName: string, contentType: string, protocolId = w.p.protocolId) {
  const evidenceId = randomUUID()
  const storagePath = `${protocolId}/${evidenceId}/${fileName}`
  const { error } = await as.storage.from('evidence').upload(storagePath, bytes, { contentType })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return { evidenceId, storagePath }
}

async function finalize(as: SupabaseClient, body: Record<string, unknown>) {
  const { data } = await as.auth.getSession()
  const response = await fetch(`${local.apiUrl}/functions/v1/finalize-evidence`, {
    method: 'POST',
    headers: { apikey: local.publishableKey, Authorization: `Bearer ${data.session!.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, string> }
}

async function exists(path: string) {
  const { data } = await serviceClient().storage.from('evidence').download(path)
  return data !== null
}

describe('finalize-evidence', () => {
  it('verifies, hashes and registers an upload, deriving its place in the hierarchy', async () => {
    const { evidenceId, storagePath } = await upload(w.tester.client, PNG, 'login.png', 'image/png')
    const result = await finalize(w.tester.client, {
      evidenceId,
      testRunId: w.p.testRunId,
      testStepId: w.p.stepId,
      storagePath,
      originalFilename: 'Login page.png',
      caption: 'Login page',
    })
    expect(result.status).toBe(201)

    const { data: row } = await w.viewer.client.from('evidence_files').select('*').eq('id', evidenceId).single()
    expect(row).toMatchObject({
      protocol_id: w.p.protocolId,
      chapter_id: w.p.chapterId,
      function_id: w.p.functionId,
      test_run_id: w.p.testRunId,
      test_step_id: w.p.stepId,
      storage_path: storagePath,
      original_filename: 'Login page.png',
      mime_type: 'image/png',
      size_bytes: PNG.length,
      sha256: createHash('sha256').update(PNG).digest('hex'),
      width: 64,
      height: 48,
      caption: 'Login page',
      uploaded_by: w.tester.id,
    })

    const [event] = await sql<{ actor_id: string }>(`select actor_id from public.audit_events where event_type = 'evidence.created' and entity_id = $1`, [evidenceId])
    expect(event!.actor_id).toBe(w.tester.id)
  })

  it('accepts evidence for the test run as a whole', async () => {
    const { evidenceId, storagePath } = await upload(w.tester.client, JPG, 'overview.jpg', 'image/jpeg')
    const result = await finalize(w.tester.client, { evidenceId, testRunId: w.p.testRunId, storagePath, originalFilename: 'overview.jpg' })
    expect(result.status).toBe(201)
    const [row] = await sql<{ test_step_id: string | null }>('select test_step_id from public.evidence_files where id = $1', [evidenceId])
    expect(row!.test_step_id).toBeNull()
  })

  it('rejects a renamed non-image, names the file, and removes the upload', async () => {
    const { evidenceId, storagePath } = await upload(w.tester.client, Buffer.from('just some text, not a picture'), 'notes.png', 'image/png')
    const result = await finalize(w.tester.client, { evidenceId, testRunId: w.p.testRunId, storagePath, originalFilename: 'notes.png' })
    expect(result.status).toBe(422)
    expect(result.body.error).toBe('notes.png is not a PNG, JPEG, WEBP, GIF or BMP image.')
    expect(await exists(storagePath)).toBe(false)
    expect((await sql('select 1 from public.evidence_files where id = $1', [evidenceId])).length).toBe(0)
  })

  it('rejects a truncated image and content that does not match the extension', async () => {
    const truncated = await upload(w.tester.client, PNG.subarray(0, 300), 'cut.png', 'image/png')
    const r1 = await finalize(w.tester.client, { evidenceId: truncated.evidenceId, testRunId: w.p.testRunId, storagePath: truncated.storagePath, originalFilename: 'cut.png' })
    expect(r1.body.error).toBe('cut.png appears to be incomplete or damaged.')

    const mismatch = await upload(w.tester.client, PNG, 'photo.jpg', 'image/jpeg')
    const r2 = await finalize(w.tester.client, { evidenceId: mismatch.evidenceId, testRunId: w.p.testRunId, storagePath: mismatch.storagePath, originalFilename: 'photo.jpg' })
    expect(r2.status).toBe(422)
    expect(r2.body.error).toBe('photo.jpg is named .jpg but its content is PNG.')
  })

  it('never touches someone else’s upload or a registered original', async () => {
    const pending = await upload(w.tester.client, PNG, 'mine.png', 'image/png')
    const body = { evidenceId: pending.evidenceId, testRunId: w.p.testRunId, storagePath: pending.storagePath, originalFilename: 'mine.png' }

    expect((await finalize(tester2.client, body)).body.code).toBe('not_owner')
    expect((await finalize(w.outsider.client, body)).status).toBe(403)
    expect((await finalize(w.viewer.client, body)).status).toBe(403)
    expect(await exists(pending.storagePath)).toBe(true)

    expect((await finalize(w.tester.client, body)).status).toBe(201)
    const again = await finalize(w.tester.client, { ...body, originalFilename: 'x.txt' })
    expect(again.body.code).toBe('already_registered')
    expect(await exists(pending.storagePath)).toBe(true)
  })

  it('refuses a path that does not match the test run’s protocol or the evidence id', async () => {
    const { evidenceId, storagePath } = await upload(w.tester.client, PNG, 'x.png', 'image/png')
    const wrongId = await finalize(w.tester.client, { evidenceId: randomUUID(), testRunId: w.p.testRunId, storagePath, originalFilename: 'x.png' })
    expect(wrongId.body.code).toBe('invalid_path')
    const wrongRun = await finalize(w.tester.client, { evidenceId, testRunId: w.q.testRunId, storagePath, originalFilename: 'x.png' })
    expect(wrongRun.body.code).toBe('invalid_path')
    expect(await exists(storagePath)).toBe(true)
  })

  it('refuses a step from another test run and cleans up', async () => {
    const otherRun = await w.manager.client
      .from('test_runs')
      .insert({ protocol_id: w.p.protocolId, function_id: w.p.functionId, title: 'Other run' })
      .select('id')
      .single()
    const { evidenceId, storagePath } = await upload(w.tester.client, PNG, 'x.png', 'image/png')
    const result = await finalize(w.tester.client, { evidenceId, testRunId: otherRun.data!.id, testStepId: w.p.stepId, storagePath, originalFilename: 'x.png' })
    expect(result.body.code).toBe('step_mismatch')
    expect(await exists(storagePath)).toBe(false)
  })

  it('enforces the administrator’s upload limit at the bucket as well', async () => {
    await w.admin.client.from('app_settings').update({ value: 1048576 }).eq('key', 'upload_limit_bytes')
    try {
      const big = Buffer.concat([PNG, Buffer.alloc(1100 * 1024)])
      const path = `${w.p.protocolId}/${randomUUID()}/big.png`
      const { error } = await w.tester.client.storage.from('evidence').upload(path, big, { contentType: 'image/png' })
      expect(error).not.toBeNull()
    } finally {
      await w.admin.client.from('app_settings').update({ value: 20971520 }).eq('key', 'upload_limit_bytes')
    }
  })
})

describe('record_step_result', () => {
  it('lets testers record results, stamping who and when', async () => {
    const { error } = await w.tester.client.rpc('record_step_result', {
      p_step_id: w.p.stepId,
      p_actual_result: 'The application opened successfully.',
      p_status: 'passed',
      p_comments: 'Build 4.2.1',
    })
    expect(error).toBeNull()
    const { data } = await w.viewer.client.from('test_steps').select('actual_result, status, comments, executed_by, executed_at').eq('id', w.p.stepId).single()
    expect(data).toMatchObject({ actual_result: 'The application opened successfully.', status: 'passed', comments: 'Build 4.2.1', executed_by: w.tester.id })
    expect(data!.executed_at).not.toBeNull()

    const [event] = await sql<{ actor_id: string; metadata: { changes: Record<string, unknown> } }>(
      `select actor_id, metadata from public.audit_events where event_type = 'test_step.result_recorded' and entity_id = $1 order by id desc limit 1`,
      [w.p.stepId],
    )
    expect(event!.actor_id).toBe(w.tester.id)
    expect(event!.metadata.changes).toHaveProperty('status', { old: 'not_started', new: 'passed' })
  })

  it('records nothing when nothing changed', async () => {
    const count = async () =>
      Number((await sql<{ n: string }>(`select count(*) n from public.audit_events where event_type = 'test_step.result_recorded' and entity_id = $1`, [w.p.stepId]))[0]!.n)
    const before = await count()
    await w.tester.client.rpc('record_step_result', {
      p_step_id: w.p.stepId,
      p_actual_result: 'The application opened successfully.',
      p_status: 'passed',
      p_comments: 'Build 4.2.1',
    })
    expect(await count()).toBe(before)
  })

  it('is refused for viewers, outsiders and archived steps', async () => {
    const args = { p_step_id: w.p.subStepId, p_actual_result: 'x', p_status: 'failed', p_comments: '' }
    expect((await w.viewer.client.rpc('record_step_result', args)).error?.code).toBe('42501')
    expect((await w.outsider.client.rpc('record_step_result', args)).error?.code).toBe('42501')
    await w.manager.client.rpc('archive_node', { p_node_type: 'test_step', p_id: w.p.subStepId })
    expect((await w.tester.client.rpc('record_step_result', args)).error?.hint).toBe('archived')
  })
})

describe('evidence metadata and archive', () => {
  it('lets managers archive evidence and keeps the file; testers cannot archive', async () => {
    const { evidenceId, storagePath } = await upload(w.tester.client, PNG, 'archive-me.png', 'image/png')
    expect((await finalize(w.tester.client, { evidenceId, testRunId: w.p.testRunId, storagePath, originalFilename: 'archive-me.png' })).status).toBe(201)

    expect((await w.tester.client.rpc('archive_node', { p_node_type: 'evidence', p_id: evidenceId })).error?.code).toBe('42501')
    expect((await w.manager.client.rpc('archive_node', { p_node_type: 'evidence', p_id: evidenceId })).data).toBe(1)
    expect((await w.viewer.client.from('evidence_files').select('id').eq('id', evidenceId)).data).toEqual([])
    expect(await exists(storagePath)).toBe(true)
  })
})
