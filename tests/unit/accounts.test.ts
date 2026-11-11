import { describe, expect, it } from 'vitest'
import { newPasswordFormSchema, normalizeUsername, passwordSchema, toAuthEmail, usernameSchema } from '@/lib/accounts'
import { toUserMessage } from '@/lib/errors'

describe('usernames', () => {
  it('normalises case and surrounding space', () => {
    expect(normalizeUsername('  Alice.B ')).toBe('alice.b')
    expect(usernameSchema.parse(' QA_Lead-1 ')).toBe('qa_lead-1')
  })

  it('accepts 3–32 characters of [a-z0-9._-] only', () => {
    for (const ok of ['abc', 'a.b-c_d', 'x'.repeat(32)]) expect(usernameSchema.safeParse(ok).success, ok).toBe(true)
    for (const bad of ['ab', 'x'.repeat(33), 'has space', 'émile', 'a@b', '']) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('maps to the synthetic Auth email on the configured domain', () => {
    expect(toAuthEmail(' Bob ', 'users.example.local')).toBe('bob@users.example.local')
  })
})

describe('passwords', () => {
  it('require 10+ characters with a letter and a digit', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false)
    expect(passwordSchema.safeParse('onlyletterss').success).toBe(false)
    expect(passwordSchema.safeParse('1234567890').success).toBe(false)
    expect(passwordSchema.safeParse('letters1234').success).toBe(true)
  })

  it('must match their confirmation', () => {
    const result = newPasswordFormSchema.safeParse({ password: 'letters1234', confirm: 'letters12345' })
    expect(result.success).toBe(false)
  })
})

describe('toUserMessage', () => {
  it('uses the message for a known database hint', () => {
    expect(toUserMessage({ hint: 'parent_archived', message: 'raw' })).toMatch(/archived/)
  })

  it('never passes raw database text through', () => {
    const raw = { code: 'XX000', message: 'relation "public.secret" does not exist at character 15' }
    expect(toUserMessage(raw)).not.toContain('public.secret')
    expect(toUserMessage(new Error('stack trace here'))).not.toContain('stack trace')
  })

  it('explains permission errors plainly', () => {
    expect(toUserMessage({ code: '42501' })).toBe('You do not have permission to do this.')
  })
})
