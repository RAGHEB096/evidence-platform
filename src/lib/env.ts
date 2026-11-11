import { z } from 'zod'

/**
 * Browser-visible configuration. Everything here ships in the bundle, so none
 * of it may be secret: only the project URL, the publishable key and the
 * synthetic email domain (ADR-001, ADR-010).
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url({ message: 'VITE_SUPABASE_URL must be a URL' }),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'VITE_SUPABASE_PUBLISHABLE_KEY is required')
    .refine((key) => !key.startsWith('sb_secret_'), {
      message: 'VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key; use the publishable key',
    }),
  VITE_AUTH_EMAIL_DOMAIN: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z0-9-]+$/, 'VITE_AUTH_EMAIL_DOMAIN must be a bare domain name'),
})

export type AppEnv = z.infer<typeof envSchema>

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; problems: string[] }

export function parseEnv(source: Record<string, unknown>): EnvResult {
  const result = envSchema.safeParse(source)
  if (result.success) return { ok: true, env: result.data }
  return { ok: false, problems: result.error.issues.map((issue) => issue.message) }
}

export const envResult = parseEnv(import.meta.env)
