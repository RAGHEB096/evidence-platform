// One-time creation of the first administrator (ADR-002).
// Two independent locks: the SETUP_TOKEN secret, and "no active administrator
// exists" (checked again inside svc_bootstrap_admin under a lock).

import { adminClient, authAdminError, authEmail, displayNameSchema, parseOrThrow, passwordSchema, usernameSchema } from '../_shared/accounts.ts'
import { z } from '../_shared/deps.ts'
import { json, readJson, secretsEqual, serve, UserFacingError } from '../_shared/http.ts'

const bodySchema = z.object({
  token: z.string().min(1, 'Enter the setup token.').max(512),
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
})

serve('bootstrap-admin', async (request) => {
  const setupToken = Deno.env.get('SETUP_TOKEN') ?? ''
  if (setupToken.length < 24) {
    // Unset (the normal state after setup) or too short to be safe.
    throw new UserFacingError(403, 'First-time setup is not available.', 'setup_disabled')
  }

  const body = parseOrThrow(bodySchema, await readJson(request))
  if (!(await secretsEqual(body.token, setupToken))) {
    throw new UserFacingError(401, 'The setup token is not correct.', 'invalid_token')
  }

  const admin = adminClient()
  const { data: needsSetup, error: needsSetupError } = await admin.rpc('needs_setup')
  if (needsSetupError) throw needsSetupError
  if (!needsSetup) {
    throw new UserFacingError(409, 'Setup has already been completed.', 'setup_done')
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail(body.username),
    password: body.password,
    email_confirm: true,
  })
  if (createError || !created.user) throw authAdminError(createError ?? {})

  const { error: profileError } = await admin.rpc('svc_bootstrap_admin', {
    p_user_id: created.user.id,
    p_username: body.username,
    p_display_name: body.displayName,
  })
  if (profileError) {
    // Undo the Auth account so a failed setup leaves nothing behind. It has no
    // profile, so it never had access to anything.
    await admin.auth.admin.deleteUser(created.user.id)
    if (profileError.hint === 'setup_done') {
      throw new UserFacingError(409, 'Setup has already been completed.', 'setup_done')
    }
    throw profileError
  }

  return json(request, 201, { ok: true })
})
