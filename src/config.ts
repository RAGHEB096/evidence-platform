/**
 * Application-wide constants. Values that differ per deployment come from
 * `import.meta.env` (see `src/lib/env.ts`); everything here is fixed.
 */

/** Usernames: lowercase, 3–32 characters, letters, digits, dot, underscore, hyphen (ADR-001). */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/

/** Keep in sync with `minimum_password_length` in supabase/config.toml and the admin-users function. */
export const PASSWORD_MIN_LENGTH = 10

/** Page size used for generated Word reports unless an administrator changes it. */
export const DEFAULT_REPORT_PAGE_SIZE = 'A4' as const

/** Upload limit used until an administrator changes it in Settings. */
export const DEFAULT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024

/** Long-edge maximum for images embedded in reports (ADR-005). */
export const DEFAULT_IMAGE_LONG_EDGE_PX = 2000

/**
 * File storage included in the Supabase Free plan (1 GB), shown against usage
 * on the administrator dashboard. Re-check against the pricing page when
 * deploying, and change it here after an upgrade.
 */
export const STORAGE_PLAN_LIMIT_BYTES = 1024 * 1024 * 1024

/** Lifetime of signed URLs used to display or fetch private files. */
export const SIGNED_URL_TTL_SECONDS = 300
