import { createClient, type SupabaseClient, z } from './deps.ts'
import { authEmailDomain, secretKey, supabaseUrl } from './env.ts'
import { UserFacingError } from './http.ts'

/** Keep in sync with src/config.ts and supabase/config.toml. */
export const PASSWORD_MIN_LENGTH = 10

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Usernames are 3–32 characters: lowercase letters, digits, dot, underscore or hyphen.')

export const displayNameSchema = z.string().trim().min(1, 'Enter a display name.').max(100, 'Display names are at most 100 characters.')

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passwords are at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, 'Passwords are at most 72 characters.')
  .regex(/[A-Za-z]/, 'Passwords need at least one letter.')
  .regex(/[0-9]/, 'Passwords need at least one digit.')

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'The request is not valid.'
    throw new UserFacingError(400, message, 'invalid_input')
  }
  return result.data
}

/** The synthetic Auth email for a username (ADR-001). Never shown to users. */
export function authEmail(username: string): string {
  return `${username}@${authEmailDomain()}`
}

/** A client with the secret key. Bypasses RLS: every use must check the caller first. */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Maps Auth admin API errors to messages that never mention the email. */
export function authAdminError(error: { message?: string; code?: string; status?: number }): UserFacingError {
  const code = error.code ?? ''
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered/i.test(error.message ?? '')) {
    return new UserFacingError(409, 'That username is already taken.', 'username_taken')
  }
  if (code === 'email_address_invalid') {
    // The synthetic domain (AUTH_EMAIL_DOMAIN) is refused by Supabase Auth (ADR-001).
    console.error('[auth-admin] AUTH_EMAIL_DOMAIN rejected by Supabase Auth', error)
    return new UserFacingError(
      500,
      'The server’s sign-in domain setting is not accepted by Supabase Auth. Change AUTH_EMAIL_DOMAIN and VITE_AUTH_EMAIL_DOMAIN (see docs/DEPLOY.md, step 5).',
      'auth_domain_rejected',
    )
  }
  if (code === 'weak_password') {
    return new UserFacingError(400, 'The password is too weak. Use at least 10 characters with letters and digits.', 'weak_password')
  }
  console.error('[auth-admin]', error)
  return new UserFacingError(502, 'The account service could not complete the request.', 'auth_failed')
}
