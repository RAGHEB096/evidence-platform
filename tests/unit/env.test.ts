import { describe, expect, it } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
  VITE_AUTH_EMAIL_DOMAIN: 'users.evidence-platform.local',
}

describe('parseEnv', () => {
  it('accepts a complete configuration', () => {
    expect(parseEnv(valid).ok).toBe(true)
  })

  it('names each missing variable', () => {
    const result = parseEnv({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toHaveLength(3)
  })

  it('refuses a secret key in the browser configuration', () => {
    const result = parseEnv({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/secret key/)
  })

  it('rejects an email domain that is not a bare domain', () => {
    expect(parseEnv({ ...valid, VITE_AUTH_EMAIL_DOMAIN: '@example.com' }).ok).toBe(false)
  })
})
