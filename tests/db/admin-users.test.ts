import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createProtocol, createUser, grantAccess, local, newPassword, signIn, sql, trySignIn, uniqueName, type TestUser } from './helpers'

async function call(as: SupabaseClient | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { apikey: local.publishableKey, 'Content-Type': 'application/json' }
  if (as) {
    const { data } = await as.auth.getSession()
    headers.Authorization = `Bearer ${data.session!.access_token}`
  }
  const response = await fetch(`${local.apiUrl}/functions/v1/admin-users`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

let admin: TestUser
let manager: TestUser

beforeAll(async () => {
  ;[admin, manager] = await Promise.all([createUser({ prefix: 'adm', isAdmin: true }), createUser({ prefix: 'mgr', canCreate: true })])
})

describe('admin-users: who may call it', () => {
  it('refuses anonymous callers and non-administrators', async () => {
    const body = { action: 'create', username: uniqueName('x'), displayName: 'X', password: newPassword() }
    expect((await call(null, body)).status).toBe(401)
    const asManager = await call(manager.client, body)
    expect(asManager.status).toBe(403)
    expect(asManager.body.code).toBe('not_admin')
  })

  it('refuses an administrator who has been deactivated, even with a live token', async () => {
    const other = await createUser({ prefix: 'adm2', isAdmin: true })
    expect((await call(admin.client, { action: 'set_active', userId: other.id, active: false })).status).toBe(200)
    const result = await call(other.client, { action: 'set_flags', userId: admin.id, isAdmin: false, canCreateProtocols: false })
    expect([401, 403]).toContain(result.status)
  })
})

describe('admin-users: creating accounts', () => {
  it('creates a user who signs in by username and must choose a new password', async () => {
    const username = uniqueName('new')
    const password = newPassword()
    const created = await call(admin.client, { action: 'create', username, displayName: 'New Person', password, canCreateProtocols: true })
    expect(created.status).toBe(201)

    const client = await signIn(username, password)
    const { data: profile } = await client
      .from('user_profiles')
      .select('username, display_name, is_admin, can_create_protocols, must_change_password')
      .single()
    expect(profile).toEqual({
      username,
      display_name: 'New Person',
      is_admin: false,
      can_create_protocols: true,
      must_change_password: true,
    })

    const [event] = await sql<{ actor_id: string }>(
      `select actor_id from public.audit_events where event_type = 'user.created' and entity_id = $1`,
      [created.body.id],
    )
    expect(event!.actor_id).toBe(admin.id)
  })

  it('normalises the username and rejects duplicates without mentioning email', async () => {
    const username = uniqueName('dup')
    expect((await call(admin.client, { action: 'create', username: username.toUpperCase(), displayName: 'A', password: newPassword() })).status).toBe(201)
    const again = await call(admin.client, { action: 'create', username, displayName: 'B', password: newPassword() })
    expect(again.status).toBe(409)
    expect(JSON.stringify(again.body)).not.toMatch(/mail|@/i)
  })

  it('enforces the username and password rules on the server', async () => {
    for (const body of [
      { username: 'ab', password: newPassword() },
      { username: 'Has Space', password: newPassword() },
      { username: uniqueName('pw'), password: 'short1' },
      { username: uniqueName('pw'), password: 'nodigitsatall' },
    ]) {
      const result = await call(admin.client, { action: 'create', displayName: 'X', ...body })
      expect(result.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('admin-users: managing accounts', () => {
  it('resets a password: the old one stops working and the user must change it', async () => {
    const user = await createUser({ prefix: 'reset' })
    const temporary = newPassword()
    expect((await call(admin.client, { action: 'reset_password', userId: user.id, password: temporary })).status).toBe(200)

    expect((await trySignIn(user.username, user.password)).error).not.toBeNull()
    const client = await signIn(user.username, temporary)
    const { data } = await client.from('user_profiles').select('must_change_password').single()
    expect(data!.must_change_password).toBe(true)

    const [event] = await sql<{ actor_id: string }>(
      `select actor_id from public.audit_events where event_type = 'user.password_reset' and entity_id = $1`,
      [user.id],
    )
    expect(event!.actor_id).toBe(admin.id)
  })

  it('deactivates (blocking sign-in and data) and reactivates', async () => {
    const user = await createUser({ prefix: 'toggle' })
    const protocolId = await createProtocol(admin.client)
    await grantAccess(admin.client, protocolId, user.id, 'viewer')
    expect((await user.client.from('protocols').select('id')).data).toHaveLength(1)

    expect((await call(admin.client, { action: 'set_active', userId: user.id, active: false })).status).toBe(200)
    expect((await user.client.from('protocols').select('id')).data).toEqual([])
    expect((await trySignIn(user.username, user.password)).error).not.toBeNull()

    expect((await call(admin.client, { action: 'set_active', userId: user.id, active: true })).status).toBe(200)
    const again = await signIn(user.username, user.password)
    expect((await again.from('protocols').select('id')).data).toHaveLength(1)

    const types = (
      await sql<{ event_type: string }>(`select event_type from public.audit_events where entity_id = $1 order by id`, [user.id])
    ).map((row) => row.event_type)
    expect(types).toContain('user.deactivated')
    expect(types).toContain('user.activated')
  })

  it('changes flags and display name', async () => {
    const user = await createUser({ prefix: 'flags' })
    expect((await call(admin.client, { action: 'set_flags', userId: user.id, isAdmin: false, canCreateProtocols: true })).status).toBe(200)
    expect((await call(admin.client, { action: 'set_display_name', userId: user.id, displayName: '  Renamed Person ' })).status).toBe(200)
    const { data } = await user.client.from('user_profiles').select('display_name, can_create_protocols').single()
    expect(data).toEqual({ display_name: 'Renamed Person', can_create_protocols: true })
    // The new flag takes effect straight away.
    expect((await user.client.rpc('create_protocol', { p_reference: uniqueName('R').toUpperCase(), p_name: 'Mine' })).error).toBeNull()
  })

  it('will not let the last active administrator deactivate or demote themselves', async () => {
    // Make `solo` the only active administrator for this test.
    const solo = await createUser({ prefix: 'solo', isAdmin: true })
    const others = await sql<{ id: string }>('select id from public.user_profiles where is_admin and is_active and id <> $1', [solo.id])
    await sql('update public.user_profiles set is_active = false where id = any($1::uuid[])', [others.map((o) => o.id)], solo.id)
    try {
      const deactivate = await call(solo.client, { action: 'set_active', userId: solo.id, active: false })
      expect(deactivate.status).toBe(409)
      expect(deactivate.body.code).toBe('last_admin')
      const demote = await call(solo.client, { action: 'set_flags', userId: solo.id, isAdmin: false, canCreateProtocols: true })
      expect(demote.status).toBe(409)
    } finally {
      await sql('update public.user_profiles set is_active = true where id = any($1::uuid[])', [others.map((o) => o.id)], solo.id)
    }
  })

  it('lets an administrator demote themselves while another administrator remains', async () => {
    const extra = await createUser({ prefix: 'extra', isAdmin: true })
    const result = await call(extra.client, { action: 'set_flags', userId: extra.id, isAdmin: false, canCreateProtocols: false })
    expect(result.status).toBe(200)
  })
})

describe('admin-users: input handling', () => {
  it('rejects unknown actions and malformed bodies with a plain message', async () => {
    const unknown = await call(admin.client, { action: 'drop_tables' })
    expect(unknown.status).toBe(400)
    const badId = await call(admin.client, { action: 'set_active', userId: 'not-a-uuid', active: false })
    expect(badId.status).toBe(400)
    expect(JSON.stringify(badId.body)).not.toMatch(/stack|sql|postgres/i)
  })
})
