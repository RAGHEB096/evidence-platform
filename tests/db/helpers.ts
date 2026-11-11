import { randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { inject } from 'vitest'

export const local = inject('supabase')

const runId = randomBytes(3).toString('hex')
let counter = 0

/** A username unique to this test run: lowercase, within 32 characters. */
export function uniqueName(prefix: string): string {
  counter += 1
  return `${prefix}.${runId}${counter}`.slice(0, 32)
}

function client(key: string): SupabaseClient {
  return createClient(local.apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export const anonClient = () => client(local.publishableKey)

/** Secret-key client: bypasses RLS. Used only to arrange fixtures, never to assert permissions. */
export const serviceClient = () => client(local.secretKey)

export const authEmail = (username: string) => `${username}@${local.authEmailDomain}`

export async function trySignIn(username: string, password: string) {
  const supabase = anonClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail(username), password })
  return { supabase, session: data.session, error }
}

export async function signIn(username: string, password: string): Promise<SupabaseClient> {
  const { supabase, error } = await trySignIn(username, password)
  if (error) throw new Error(`Sign-in failed for ${username}: ${error.message}`)
  return supabase
}

export interface TestUser {
  id: string
  username: string
  password: string
  client: SupabaseClient
}

export const newPassword = () => `Pw-${randomBytes(9).toString('base64url')}1a`

/**
 * Creates an account the way the admin-users function does (Auth admin API,
 * then svc_create_user with the bootstrap administrator as actor), signs in,
 * and, unless told otherwise, completes the forced password change.
 */
export async function createUser(
  options: { prefix?: string; isAdmin?: boolean; canCreate?: boolean; keepMustChange?: boolean } = {},
): Promise<TestUser> {
  const service = serviceClient()
  const username = uniqueName(options.prefix ?? 'user')
  const initialPassword = newPassword()

  const { data, error } = await service.auth.admin.createUser({
    email: authEmail(username),
    password: initialPassword,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  const { error: profileError } = await service.rpc('svc_create_user', {
    p_actor: local.admin.id,
    p_user_id: data.user.id,
    p_username: username,
    p_display_name: `Test ${username}`,
    p_is_admin: options.isAdmin ?? false,
    p_can_create_protocols: options.canCreate ?? false,
  })
  if (profileError) throw new Error(`svc_create_user failed: ${profileError.message}`)

  const supabase = await signIn(username, initialPassword)
  if (options.keepMustChange) return { id: data.user.id, username, password: initialPassword, client: supabase }

  const password = newPassword()
  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) throw new Error(`updateUser failed: ${updateError.message}`)
  const { data: changed, error: completeError } = await supabase.rpc('complete_password_change')
  if (completeError || changed !== true) throw new Error(`complete_password_change failed: ${completeError?.message}`)

  return { id: data.user.id, username, password, client: supabase }
}

/** Runs SQL as the database owner with an explicit acting user, as server code would. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  actor: string = local.admin.id,
): Promise<T[]> {
  const db = new pg.Client({ connectionString: local.dbUrl })
  await db.connect()
  try {
    await db.query('begin')
    await db.query(`select set_config('app.actor_id', $1, true)`, [actor])
    const result = await db.query<T>(text, params)
    await db.query('commit')
    return result.rows
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally {
    await db.end()
  }
}

export async function createProtocol(as: SupabaseClient, name = 'Protocol'): Promise<string> {
  const { data, error } = await as.rpc('create_protocol', {
    p_reference: uniqueName('ref').toUpperCase(),
    p_name: name,
  })
  if (error) throw new Error(`create_protocol failed: ${error.message}`)
  return data as string
}

export async function grantAccess(as: SupabaseClient, protocolId: string, userId: string, role: 'viewer' | 'tester' | 'manager') {
  const { error } = await as.from('protocol_access').insert({ protocol_id: protocolId, user_id: userId, role })
  if (error) throw new Error(`grant failed: ${error.message}`)
}

export interface Hierarchy {
  protocolId: string
  chapterId: string
  functionId: string
  testRunId: string
  stepId: string
  subStepId: string
}

/** Builds chapter → function → test run → step → sub-step through the API as `as`. */
export async function buildHierarchy(as: SupabaseClient, protocolId: string): Promise<Hierarchy> {
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await as.from(table).insert(row).select('id').single()
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
    return (data as { id: string }).id
  }
  const chapterId = await insert('chapters', { protocol_id: protocolId, title: 'SMT Line 1' })
  const functionId = await insert('functions', { protocol_id: protocolId, chapter_id: chapterId, title: 'Barcode Verification' })
  const testRunId = await insert('test_runs', { protocol_id: protocolId, function_id: functionId, reference: 'TR-001', title: 'Test Run 001' })
  const stepId = await insert('test_steps', {
    protocol_id: protocolId,
    test_run_id: testRunId,
    reference: '1',
    description: 'Open the application.',
    expected_result: 'The application opens successfully.',
  })
  const subStepId = await insert('test_steps', {
    protocol_id: protocolId,
    test_run_id: testRunId,
    parent_step_id: stepId,
    reference: '1.1',
    description: 'Log in.',
  })
  return { protocolId, chapterId, functionId, testRunId, stepId, subStepId }
}

/** 1×1 transparent PNG. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** Registers an evidence row directly (Phase 5 replaces this with finalize-evidence). */
export async function insertEvidence(h: Hierarchy, uploadedBy: string, options: { withStep?: boolean } = {}) {
  const id = randomUUID()
  const storagePath = `${h.protocolId}/${id}/screenshot.png`
  await sql(
    `insert into public.evidence_files
       (id, protocol_id, chapter_id, function_id, test_run_id, test_step_id, storage_path,
        original_filename, mime_type, size_bytes, sha256, width, height, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, 'screenshot.png', 'image/png', $8, $9, 1, 1, $10)`,
    [
      id,
      h.protocolId,
      h.chapterId,
      h.functionId,
      h.testRunId,
      options.withStep === false ? null : h.stepId,
      storagePath,
      TINY_PNG.length,
      'a'.repeat(64),
      uploadedBy,
    ],
    uploadedBy,
  )
  return { id, storagePath }
}
