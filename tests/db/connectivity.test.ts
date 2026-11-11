import { createClient } from '@supabase/supabase-js'
import { describe, expect, inject, it } from 'vitest'

const local = inject('supabase')

describe('local Supabase', () => {
  it('answers on the Auth health endpoint', async () => {
    const response = await fetch(`${local.apiUrl}/auth/v1/health`, {
      headers: { apikey: local.publishableKey },
    })
    expect(response.ok).toBe(true)
  })

  it('refuses public sign-ups (ADR-001)', async () => {
    const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } })
    const { data, error } = await client.auth.signUp({
      email: `signup-probe-${Date.now()}@users.evidence-platform.local`,
      password: 'Probe-password-123',
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})
