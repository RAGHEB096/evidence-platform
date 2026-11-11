// Account administration for active administrators: create users, reset
// passwords, activate/deactivate, change display name and flags.
// Every write goes through a svc_* RPC that re-checks the actor and records
// it in the audit trail (ADR-013).

import { adminClient, authAdminError, authEmail, displayNameSchema, parseOrThrow, passwordSchema, usernameSchema } from '../_shared/accounts.ts'
import { requireAdmin, rpcError } from '../_shared/caller.ts'
import { z } from '../_shared/deps.ts'
import { json, readJson, serve, UserFacingError } from '../_shared/http.ts'

/** Long enough to be permanent; cleared again on reactivation. */
const BAN_DURATION = '876000h'

const userId = z.uuid('Unknown user.')

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    isAdmin: z.boolean().default(false),
    canCreateProtocols: z.boolean().default(false),
  }),
  z.object({ action: z.literal('reset_password'), userId, password: passwordSchema }),
  z.object({ action: z.literal('set_active'), userId, active: z.boolean() }),
  z.object({ action: z.literal('set_flags'), userId, isAdmin: z.boolean(), canCreateProtocols: z.boolean() }),
  z.object({ action: z.literal('set_display_name'), userId, displayName: displayNameSchema }),
])

serve('admin-users', async (request) => {
  const admin = adminClient()
  const caller = await requireAdmin(request, admin)
  const body = parseOrThrow(requestSchema, await readJson(request))

  switch (body.action) {
    case 'create': {
      const { data: existing } = await admin.from('user_profiles').select('id').eq('username', body.username).maybeSingle()
      if (existing) throw new UserFacingError(409, 'That username is already taken.', 'username_taken')

      const { data, error } = await admin.auth.admin.createUser({
        email: authEmail(body.username),
        password: body.password,
        email_confirm: true,
      })
      if (error || !data.user) throw authAdminError(error ?? {})

      const { error: profileError } = await admin.rpc('svc_create_user', {
        p_actor: caller.id,
        p_user_id: data.user.id,
        p_username: body.username,
        p_display_name: body.displayName,
        p_is_admin: body.isAdmin,
        p_can_create_protocols: body.canCreateProtocols,
      })
      if (profileError) {
        // No profile means no access, but do not leave the Auth account behind.
        await admin.auth.admin.deleteUser(data.user.id)
        throw rpcError(profileError)
      }
      return json(request, 201, { id: data.user.id })
    }

    case 'reset_password': {
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password: body.password })
      if (error) throw authAdminError(error)
      const { error: rpcFailure } = await admin.rpc('svc_record_password_reset', { p_actor: caller.id, p_user_id: body.userId })
      if (rpcFailure) throw rpcError(rpcFailure)
      return json(request, 200, { ok: true })
    }

    case 'set_active': {
      if (body.active) {
        // Lift the Auth ban first, then reopen access in the database.
        const { error } = await admin.auth.admin.updateUserById(body.userId, { ban_duration: 'none' })
        if (error) throw authAdminError(error)
        const { error: rpcFailure } = await admin.rpc('svc_set_user_active', { p_actor: caller.id, p_user_id: body.userId, p_active: true })
        if (rpcFailure) throw rpcError(rpcFailure)
      } else {
        // Close access in the database first (checks the last-administrator
        // rule), then ban so no new session or token refresh succeeds.
        const { error: rpcFailure } = await admin.rpc('svc_set_user_active', { p_actor: caller.id, p_user_id: body.userId, p_active: false })
        if (rpcFailure) throw rpcError(rpcFailure)
        const { error } = await admin.auth.admin.updateUserById(body.userId, { ban_duration: BAN_DURATION })
        if (error) {
          console.error('[admin-users] ban failed after deactivation', error)
          throw new UserFacingError(
            502,
            'The account was deactivated, but blocking new sign-ins failed. Deactivate it again to retry.',
            'ban_failed',
          )
        }
      }
      return json(request, 200, { ok: true })
    }

    case 'set_flags': {
      const { error } = await admin.rpc('svc_set_user_flags', {
        p_actor: caller.id,
        p_user_id: body.userId,
        p_is_admin: body.isAdmin,
        p_can_create_protocols: body.canCreateProtocols,
      })
      if (error) throw rpcError(error)
      return json(request, 200, { ok: true })
    }

    case 'set_display_name': {
      const { error } = await admin.rpc('svc_set_display_name', {
        p_actor: caller.id,
        p_user_id: body.userId,
        p_display_name: body.displayName,
      })
      if (error) throw rpcError(error)
      return json(request, 200, { ok: true })
    }
  }
})
