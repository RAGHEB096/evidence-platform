import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createUser, grantAccess, local, newPassword, sql, type TestUser } from './helpers'
import { buildWorld, type World } from './world'

const PNG = readFileSync('tests/fixtures/images/screenshot.png')
let w: World
let extra: TestUser

async function adminUsers(as: TestUser, body: Record<string, unknown>) {
  const { data } = await as.client.auth.getSession()
  const response = await fetch(`${local.apiUrl}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { apikey: local.publishableKey, Authorization: `Bearer ${data.session!.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`admin-users ${body.action}: ${response.status} ${await response.text()}`)
}

/**
 * Performs every action SPEC 4.10 lists, through the same routes the app
 * uses, then checks each left an audit event with the right actor.
 */
beforeAll(async () => {
  w = await buildWorld()
  const admin = w.admin
  extra = await createUser({ prefix: 'audited' })

  // Users: deactivation, password reset.
  await adminUsers(admin, { action: 'set_active', userId: extra.id, active: false })
  await adminUsers(admin, { action: 'set_active', userId: extra.id, active: true })
  await adminUsers(admin, { action: 'reset_password', userId: extra.id, password: newPassword() })

  // Access granted, changed, removed.
  await grantAccess(admin.client, w.p.protocolId, extra.id, 'viewer')
  await admin.client.from('protocol_access').update({ role: 'tester' }).eq('protocol_id', w.p.protocolId).eq('user_id', extra.id)
  await admin.client.from('protocol_access').delete().eq('protocol_id', w.p.protocolId).eq('user_id', extra.id)

  // Protocol and structure changes; a result.
  await w.manager.client.from('protocols').update({ description: 'Changed' }).eq('id', w.p.protocolId)
  await w.manager.client.from('test_steps').update({ expected_result: 'Changed' }).eq('id', w.p.subStepId)
  await w.tester.client.rpc('record_step_result', { p_step_id: w.p.subStepId, p_actual_result: 'OK', p_status: 'passed', p_comments: '' })

  // Evidence upload (through finalize-evidence), metadata change, archival.
  const evidenceId = crypto.randomUUID()
  const storagePath = `${w.p.protocolId}/${evidenceId}/audit.png`
  await w.tester.client.storage.from('evidence').upload(storagePath, PNG, { contentType: 'image/png' })
  const { error } = await w.tester.client.functions.invoke('finalize-evidence', {
    body: { evidenceId, testRunId: w.p.testRunId, testStepId: w.p.subStepId, storagePath, originalFilename: 'audit.png' },
  })
  if (error) throw error
  await w.tester.client.from('evidence_files').update({ caption: 'Caption' }).eq('id', evidenceId)

  // Selection changes and document generation.
  const { data: draft } = await w.manager.client.from('document_exports').insert({ protocol_id: w.p.protocolId, name: 'Audit report' }).select('id').single()
  const exportId = (draft as { id: string }).id
  await w.manager.client.from('document_export_items').insert({ export_id: exportId, protocol_id: w.p.protocolId, evidence_id: evidenceId, position: 1 })
  await w.manager.client.from('document_export_items').update({ caption_override: 'Override' }).eq('export_id', exportId)
  await w.manager.client.from('document_export_items').insert({ export_id: exportId, protocol_id: w.p.protocolId, evidence_id: w.evidenceP.id, position: 2 })
  await w.manager.client.from('document_export_items').delete().eq('export_id', exportId).eq('evidence_id', w.evidenceP.id)
  await w.manager.client.rpc('finalize_export', {
    p_export_id: exportId,
    p_storage_path: null,
    p_sha256: 'c'.repeat(64),
    p_file_size_bytes: 1,
    p_chapter_count: 1,
    p_test_run_count: 1,
    p_step_count: 1,
    p_image_count: 1,
  })
  await w.manager.client.rpc('archive_node', { p_node_type: 'evidence', p_id: evidenceId })

  // Settings.
  await admin.client.from('app_settings').update({ value: 2500 }).eq('key', 'image_long_edge_px')
  await admin.client.from('app_settings').update({ value: 2000 }).eq('key', 'image_long_edge_px')
})

describe('audit coverage of SPEC 4.10', () => {
  it.each([
    // Fixture accounts are created with the bootstrap administrator as actor.
    ['user creation', 'user.created', () => local.admin.id],
    ['deactivation', 'user.deactivated', () => w.admin.id],
    ['password reset', 'user.password_reset', () => w.admin.id],
    ['protocol creation', 'protocol.created', () => w.manager.id],
    ['protocol change', 'protocol.updated', () => w.manager.id],
    ['chapter change', 'chapter.created', () => w.manager.id],
    ['function change', 'function.created', () => w.manager.id],
    ['test run change', 'test_run.created', () => w.manager.id],
    ['step change', 'test_step.updated', () => w.manager.id],
    ['result change', 'test_step.result_recorded', () => w.tester.id],
    ['evidence upload', 'evidence.created', () => w.tester.id],
    ['evidence metadata change', 'evidence.metadata_changed', () => w.tester.id],
    ['evidence archival', 'evidence.archived', () => w.manager.id],
    ['selection added', 'selection.added', () => w.manager.id],
    ['selection changed', 'selection.changed', () => w.manager.id],
    ['selection removed', 'selection.removed', () => w.manager.id],
    ['document generation', 'document_export.generated', () => w.manager.id],
    ['access granted', 'access.granted', () => w.admin.id],
    ['access changed', 'access.changed', () => w.admin.id],
    ['access removed', 'access.removed', () => w.admin.id],
    ['setting change', 'setting.updated', () => w.admin.id],
  ])('records %s (%s) with its actor and a server timestamp', async (_label, eventType, actor) => {
    const rows = await sql<{ n: string }>(
      `select count(*) n from public.audit_events where event_type = $1 and actor_id = $2 and occurred_at > now() - interval '10 minutes'`,
      [eventType, actor()],
    )
    expect(Number(rows[0]!.n)).toBeGreaterThan(0)
  })

  it('lets testers see their own actions, but not other people’s', async () => {
    const own = await w.tester.client.from('audit_events').select('actor_id')
    expect(own.data!.length).toBeGreaterThan(0)
    expect(own.data!.every((row) => row.actor_id === w.tester.id)).toBe(true)
  })
})
