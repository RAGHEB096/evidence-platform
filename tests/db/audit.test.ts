import { beforeAll, describe, expect, it } from 'vitest'
import { serviceClient, sql } from './helpers'
import { buildWorld, type World } from './world'

let w: World

beforeAll(async () => {
  w = await buildWorld()
})

async function auditCount() {
  const [row] = await sql<{ n: string }>('select count(*) as n from public.audit_events')
  return Number(row!.n)
}

describe('audit trail (ADR-007)', () => {
  it('cannot be inserted, updated or deleted by any user role', async () => {
    const before = await auditCount()
    const [someEvent] = await sql<{ id: string }>('select id from public.audit_events order by id limit 1')

    for (const user of [w.admin, w.manager, w.tester, w.viewer, w.outsider]) {
      const inserted = await user.client.from('audit_events').insert({
        actor_id: user.id,
        event_type: 'forged',
        entity_type: 'forged',
      })
      expect(inserted.error, `${user.username} insert`).not.toBeNull()

      const updated = await user.client.from('audit_events').update({ event_type: 'tampered' }).eq('id', someEvent!.id).select('id')
      expect(updated.error ?? updated.data?.length === 0, `${user.username} update`).toBeTruthy()

      const deleted = await user.client.from('audit_events').delete().eq('id', someEvent!.id).select('id')
      expect(deleted.error ?? deleted.data?.length === 0, `${user.username} delete`).toBeTruthy()
    }

    expect(await auditCount()).toBe(before)
    const [unchanged] = await sql<{ event_type: string }>('select event_type from public.audit_events where id = $1', [someEvent!.id])
    expect(unchanged!.event_type).not.toBe('tampered')
  })

  it('rejects updates and deletes even with the secret key', async () => {
    const [someEvent] = await sql<{ id: string }>('select id from public.audit_events order by id limit 1')
    const service = serviceClient()
    const updated = await service.from('audit_events').update({ event_type: 'tampered' }).eq('id', someEvent!.id)
    expect(updated.error?.hint).toBe('audit_append_only')
    const deleted = await service.from('audit_events').delete().eq('id', someEvent!.id)
    expect(deleted.error?.hint).toBe('audit_append_only')
  })

  it('refuses a change that has no acting user', async () => {
    // A secret-key write through the table API has no JWT subject and no
    // declared actor, so the audit trigger rejects it and nothing is stored.
    const { error } = await serviceClient().from('chapters').update({ title: 'No actor' }).eq('id', w.p.chapterId)
    expect(error?.hint).toBe('audit_actor_missing')
    const [chapter] = await sql<{ title: string }>('select title from public.chapters where id = $1', [w.p.chapterId])
    expect(chapter!.title).not.toBe('No actor')
  })

  it('records who did what, with server time and the changed values', async () => {
    const before = new Date(Date.now() - 60_000)
    await w.manager.client.from('chapters').update({ title: 'SMT Line 1 (renamed)' }).eq('id', w.p.chapterId)

    const events = await sql<{
      actor_id: string
      event_type: string
      entity_type: string
      entity_id: string
      protocol_id: string
      occurred_at: Date
      metadata: { changes: Record<string, { old: unknown; new: unknown }> }
    }>(
      `select actor_id, event_type, entity_type, entity_id, protocol_id, occurred_at, metadata
       from public.audit_events where entity_id = $1 and event_type = 'chapter.updated' order by id desc limit 1`,
      [w.p.chapterId],
    )
    const event = events[0]!
    expect(event.actor_id).toBe(w.manager.id)
    expect(event.entity_type).toBe('chapter')
    expect(event.protocol_id).toBe(w.p.protocolId)
    expect(event.occurred_at.getTime()).toBeGreaterThan(before.getTime())
    expect(event.metadata.changes.title).toEqual({ old: 'SMT Line 1', new: 'SMT Line 1 (renamed)' })
    expect(event.metadata.changes).not.toHaveProperty('updated_at')
  })

  it('records the events Phase 2 can produce', async () => {
    const rows = await sql<{ event_type: string }>(
      `select distinct event_type from public.audit_events where protocol_id = $1 or entity_type = 'user'`,
      [w.p.protocolId],
    )
    const types = rows.map((row) => row.event_type)
    for (const expected of [
      'user.created',
      'user.password_changed',
      'protocol.created',
      'access.granted',
      'chapter.created',
      'function.created',
      'test_run.created',
      'test_step.created',
      'evidence.created',
    ]) {
      expect(types, expected).toContain(expected)
    }
  })

  it('does not record a protocol change when only its last-modified time moved', async () => {
    const protocolEvents = async () =>
      Number(
        (await sql<{ n: string }>(`select count(*) as n from public.audit_events where entity_type = 'protocol' and entity_id = $1`, [
          w.p.protocolId,
        ]))[0]!.n,
      )
    const before = await protocolEvents()
    await w.manager.client.from('chapters').update({ description: 'bump' }).eq('id', w.p.chapterId)
    expect(await protocolEvents()).toBe(before)
  })
})
