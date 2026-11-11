import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const ADMIN_STATE = 'playwright/.auth/admin.json'
const ADMIN_CREDENTIALS = 'playwright/.auth/admin-credentials.json'

export interface Credentials {
  username: string
  password: string
  displayName: string
}

export function newPassword(): string {
  return `E2e-${randomBytes(9).toString('base64url')}7x`
}

export function saveAdminCredentials(credentials: Credentials) {
  mkdirSync(dirname(ADMIN_CREDENTIALS), { recursive: true })
  writeFileSync(ADMIN_CREDENTIALS, JSON.stringify(credentials))
}

export function adminCredentials(): Credentials {
  return JSON.parse(readFileSync(ADMIN_CREDENTIALS, 'utf8')) as Credentials
}

export function setupToken(): string {
  const match = /^SETUP_TOKEN=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))
  if (!match) throw new Error('SETUP_TOKEN is missing from supabase/functions/.env')
  return match[1]!.trim()
}

export function authEmailDomain(): string {
  const match = /^AUTH_EMAIL_DOMAIN=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))
  return match![1]!.trim()
}

function localEnv(key: string): string {
  const match = new RegExp(`^${key}=(.+)$`, 'm').exec(readFileSync('.env.local', 'utf8'))
  if (!match) throw new Error(`${key} is missing from .env.local`)
  return match[1]!.trim()
}

/** A supabase-js client signed in as the E2E administrator, for arranging data quickly. */
export async function adminApi(): Promise<SupabaseClient> {
  const client = createClient(localEnv('VITE_SUPABASE_URL'), localEnv('VITE_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = adminCredentials()
  const { error } = await client.auth.signInWithPassword({ email: `${admin.username}@${authEmailDomain()}`, password: admin.password })
  if (error) throw new Error(`admin API sign-in failed: ${error.message}`)
  return client
}

/** Creates a protocol with one chapter, function and test run, and the given steps. */
export async function arrangeProtocol(api: SupabaseClient, reference: string, steps: { description: string; expected: string }[]) {
  const { data: protocolId, error } = await api.rpc('create_protocol', { p_reference: reference, p_name: `Protocol ${reference}` })
  if (error) throw error
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error: insertError } = await api.from(table).insert(row).select('id').single()
    if (insertError) throw insertError
    return (data as { id: string }).id
  }
  const chapterId = await insert('chapters', { protocol_id: protocolId, title: 'SMT Line 1' })
  const functionId = await insert('functions', { protocol_id: protocolId, chapter_id: chapterId, title: 'Barcode Verification' })
  const testRunId = await insert('test_runs', { protocol_id: protocolId, function_id: functionId, reference: 'TR-001', title: 'Test Run 001' })
  const stepIds: string[] = []
  for (const step of steps) {
    stepIds.push(await insert('test_steps', { protocol_id: protocolId, test_run_id: testRunId, description: step.description, expected_result: step.expected }))
  }
  return { protocolId: protocolId as string, chapterId, functionId, testRunId, stepIds }
}

export const fixture = (name: string) => readFileSync(`tests/fixtures/images/${name}`)

/** Uploads and finalises one evidence file through the real API path. */
export async function uploadEvidenceApi(
  api: SupabaseClient,
  target: { protocolId: string; testRunId: string; testStepId: string | null },
  fileName: string,
  bytes: Buffer,
  mimeType: string,
  caption = '',
) {
  const evidenceId = crypto.randomUUID()
  const storagePath = `${target.protocolId}/${evidenceId}/${fileName}`
  const { error } = await api.storage.from('evidence').upload(storagePath, bytes, { contentType: mimeType })
  if (error) throw error
  const { error: finalizeError } = await api.functions.invoke('finalize-evidence', {
    body: { evidenceId, testRunId: target.testRunId, testStepId: target.testStepId, storagePath, originalFilename: fileName, caption },
  })
  if (finalizeError) throw finalizeError
  return evidenceId
}

/** Fails the test if the page throws an uncaught error. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return () => expect(errors, 'uncaught page errors').toEqual([])
}

export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}
