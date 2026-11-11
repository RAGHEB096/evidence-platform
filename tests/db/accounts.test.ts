import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  anonClient,
  buildHierarchy,
  createProtocol,
  createUser,
  grantAccess,
  local,
  newPassword,
  serviceClient,
  signIn,
  sql,
  trySignIn,
} from './helpers'

const bootstrap = (body: Record<string, unknown>) =>
  fetch(`${local.apiUrl}/functions/v1/bootstrap-admin`, {
    method: 'POST',
    headers: { apikey: local.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('first-time setup (ADR-002)', () => {
  it('reports that setup is no longer needed once an administrator exists', async () => {
    const { data, error } = await anonClient().rpc('needs_setup')
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('refuses a wrong setup token without saying anything else', async () => {
    const response = await bootstrap({ token: 'not-the-token', username: 'intruder', displayName: 'X', password: 'Password1234' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'The setup token is not correct.', code: 'invalid_token' })
  })

  it('cannot create a second administrator even with the right token', async () => {
    const token = readFileSync('supabase/functions/.env', 'utf8').match(/^SETUP_TOKEN=(.+)$/m)![1]!.trim()
    const response = await bootstrap({ token, username: 'second.admin', displayName: 'Second', password: 'Password1234' })
    expect(response.status).toBe(409)
    const { data } = await serviceClient().from('user_profiles').select('id').eq('username', 'second.admin')
    expect(data).toEqual([])
  })

  it('cannot be called by API roles directly', async () => {
    const { error } = await anonClient().rpc('svc_bootstrap_admin', {
      p_user_id: local.admin.id,
      p_username: 'x.y.z',
      p_display_name: 'X',
    })
    expect(error).not.toBeNull()
  })

  it('lets the bootstrapped administrator sign in by username', async () => {
    const { session, error } = await trySignIn(local.admin.username, local.admin.password)
    expect(error).toBeNull()
    const admin = await signIn(local.admin.username, local.admin.password)
    const { data: profile } = await admin
      .from('user_profiles')
      .select('username, is_admin, is_active')
      .eq('id', session!.user.id)
      .single()
    expect(profile).toEqual({ username: local.admin.username, is_admin: true, is_active: true })
  })
})

describe('sign-in', () => {
  it('gives the same error for an unknown user and a wrong password', async () => {
    const unknown = await trySignIn('no.such.user', 'Whatever12345')
    const wrong = await trySignIn(local.admin.username, 'Wrong-password-1')
    expect(unknown.error?.message).toBeTruthy()
    expect(unknown.error?.message).toBe(wrong.error?.message)
  })

  it('refuses public sign-up', async () => {
    const { data, error } = await anonClient().auth.signUp({ email: `self.${Date.now()}@${local.authEmailDomain}`, password: 'Password1234' })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })

  it('stores no email or password in the profile table', async () => {
    const rows = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles'`,
    )
    const columns = rows.map((row) => row.column_name)
    expect(columns.some((name) => /mail|password_hash|encrypted/.test(name))).toBe(false)
  })
})

describe('forced password change (ADR-012)', () => {
  it('grants no protocol access until the user has chosen a new password', async () => {
    const admin = await createUser({ prefix: 'adm', isAdmin: true })
    const pending = await createUser({ prefix: 'pending', keepMustChange: true })
    const protocolId = await createProtocol(admin.client)
    await grantAccess(admin.client, protocolId, pending.id, 'viewer')

    const before = await pending.client.from('protocols').select('id').eq('id', protocolId)
    expect(before.data).toEqual([])

    // Calling the completion RPC without changing the password changes nothing.
    const { data: unchanged } = await pending.client.rpc('complete_password_change')
    expect(unchanged).toBe(false)
    expect((await pending.client.from('protocols').select('id').eq('id', protocolId)).data).toEqual([])

    // Clearing the flag directly is not possible either.
    await pending.client.from('user_profiles').update({ must_change_password: false }).eq('id', pending.id)
    const [flag] = await sql<{ must_change_password: boolean }>(
      'select must_change_password from public.user_profiles where id = $1',
      [pending.id],
    )
    expect(flag!.must_change_password).toBe(true)

    const { error: updateError } = await pending.client.auth.updateUser({ password: newPassword() })
    expect(updateError).toBeNull()
    const { data: changed } = await pending.client.rpc('complete_password_change')
    expect(changed).toBe(true)

    const after = await pending.client.from('protocols').select('id').eq('id', protocolId)
    expect(after.data).toEqual([{ id: protocolId }])
  })
})

describe('deactivation', () => {
  it('locks a user out immediately, including an existing session, and blocks new sign-ins', async () => {
    const admin = await createUser({ prefix: 'adm', isAdmin: true })
    const user = await createUser({ prefix: 'leaver' })
    const protocolId = await createProtocol(admin.client)
    await grantAccess(admin.client, protocolId, user.id, 'tester')
    const h = await buildHierarchy(admin.client, protocolId)
    expect((await user.client.from('chapters').select('id').eq('id', h.chapterId)).data).toHaveLength(1)

    // What admin-users does: flag the profile, then ban the Auth user.
    const service = serviceClient()
    const { error: flagError } = await service.rpc('svc_set_user_active', { p_actor: admin.id, p_user_id: user.id, p_active: false })
    expect(flagError).toBeNull()
    const { error: banError } = await service.auth.admin.updateUserById(user.id, { ban_duration: '876000h' })
    expect(banError).toBeNull()

    // The still-valid access token now gets nothing.
    expect((await user.client.from('chapters').select('id').eq('id', h.chapterId)).data).toEqual([])
    expect((await user.client.from('protocols').select('id')).data).toEqual([])
    const { data: updated } = await user.client.from('chapters').update({ title: 'x' }).eq('id', h.chapterId).select('id')
    expect(updated ?? []).toEqual([])

    // And a fresh sign-in is refused.
    const { error } = await trySignIn(user.username, user.password)
    expect(error).not.toBeNull()
  })

  it('refuses to deactivate the last active administrator', async () => {
    // Deactivating every administrator but one must stop at the last.
    const admins = await sql<{ id: string }>('select id from public.user_profiles where is_admin and is_active')
    const service = serviceClient()
    const keeper = admins[0]!.id
    const results = []
    for (const { id } of admins.slice(1)) {
      results.push((await service.rpc('svc_set_user_active', { p_actor: keeper, p_user_id: id, p_active: false })).error)
    }
    expect(results.every((error) => error === null)).toBe(true)
    const { error } = await service.rpc('svc_set_user_active', { p_actor: keeper, p_user_id: keeper, p_active: false })
    expect(error?.hint).toBe('last_admin')

    // Restore the others for the remaining tests.
    for (const { id } of admins.slice(1)) {
      await service.rpc('svc_set_user_active', { p_actor: keeper, p_user_id: id, p_active: true })
    }
  })

  it('refuses account administration from a non-administrator actor', async () => {
    const user = await createUser({ prefix: 'plain' })
    const { error } = await serviceClient().rpc('svc_set_user_active', { p_actor: user.id, p_user_id: local.admin.id, p_active: false })
    expect(error?.hint).toBe('not_admin')
  })
})
