import { z } from 'zod'
import { PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@/config'

/** Lowercases and trims, so "  Alice " and "alice" are the same account. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

/**
 * The synthetic Auth email behind a username (ADR-001). Used only to call
 * Supabase Auth; it must never be rendered, logged to the UI or exported.
 */
export function toAuthEmail(username: string, domain: string): string {
  return `${normalizeUsername(username)}@${domain}`
}

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z.string().regex(USERNAME_PATTERN, 'Use 3–32 characters: lowercase letters, digits, dot, underscore or hyphen.'),
  )

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(100, 'Display names are at most 100 characters.')

/** Mirrors the Auth password policy (supabase/config.toml) and the admin-users function. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, 'Use at most 72 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one digit.')

export const newPasswordFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((value) => value.password === value.confirm, { message: 'The passwords do not match.', path: ['confirm'] })
