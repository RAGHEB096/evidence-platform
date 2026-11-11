import type { SupabaseClient } from './deps.ts'
import { UserFacingError } from './http.ts'

export interface Caller {
  id: string
  username: string
  isAdmin: boolean
  token: string
}

/**
 * Verifies the bearer token with the Auth server (ADR-014): this fails for
 * expired, signed-out and banned users. Then requires an active profile that
 * is not waiting for a password change.
 */
export async function requireCaller(request: Request, admin: SupabaseClient): Promise<Caller> {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new UserFacingError(401, 'Sign in to do this.', 'not_signed_in')

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new UserFacingError(401, 'Your session has ended. Sign in again.', 'not_signed_in')

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, username, is_admin, is_active, must_change_password')
    .eq('id', data.user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile || !profile.is_active || profile.must_change_password) {
    throw new UserFacingError(403, 'Your account cannot do this.', 'not_allowed')
  }
  return { id: profile.id, username: profile.username, isAdmin: profile.is_admin, token }
}

export async function requireAdmin(request: Request, admin: SupabaseClient): Promise<Caller> {
  const caller = await requireCaller(request, admin)
  if (!caller.isAdmin) throw new UserFacingError(403, 'Only an administrator can do this.', 'not_admin')
  return caller
}

/** Maps the hints raised by svc_* functions to user-facing errors. */
export function rpcError(error: { hint?: string | null; message?: string; code?: string }): Error {
  switch (error.hint) {
    case 'last_admin':
      return new UserFacingError(409, 'This would leave no active administrator.', 'last_admin')
    case 'not_admin':
      return new UserFacingError(403, 'Only an active administrator can do this.', 'not_admin')
    case 'user_not_found':
      return new UserFacingError(404, 'That user does not exist.', 'user_not_found')
  }
  if (error.code === '23505') return new UserFacingError(409, 'That username is already taken.', 'username_taken')
  return error as Error
}
