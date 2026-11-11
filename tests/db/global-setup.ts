import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { TestProject } from 'vitest/node'

export interface LocalSupabase {
  apiUrl: string
  dbUrl: string
  publishableKey: string
  secretKey: string
  authEmailDomain: string
  /** The administrator created through bootstrap-admin for this run. */
  admin: { id: string; username: string; password: string }
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase
  }
}

function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) values.set(match[1]!, match[2]!)
  }
  return values
}

async function waitFor(url: string, headers: Record<string, string>) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers })
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

/**
 * 1. Reads connection details from the running local stack (no keys in files).
 * 2. Resets the local database, so every run starts from the migrations alone.
 * 3. Creates the first administrator through the real bootstrap-admin function.
 * Fails with instructions if the stack is not running; there is no mock fallback.
 */
export default async function setup(project: TestProject) {
  let output: string
  try {
    output = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start`, then rerun `npm run test:db`.')
  }
  const status = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) status.set(match[1]!, match[2]!)
  }
  const read = (key: string) => {
    const value = status.get(key)
    if (!value) throw new Error(`\`supabase status\` did not report ${key}. Is the local stack healthy?`)
    return value
  }
  const apiUrl = read('API_URL')
  const publishableKey = read('PUBLISHABLE_KEY')

  const functionEnv = readEnvFile('supabase/functions/.env')
  const setupToken = functionEnv.get('SETUP_TOKEN')
  const authEmailDomain = functionEnv.get('AUTH_EMAIL_DOMAIN')
  if (!setupToken || !authEmailDomain) {
    throw new Error('supabase/functions/.env needs SETUP_TOKEN and AUTH_EMAIL_DOMAIN (see supabase/functions/.env.example).')
  }

  execSync('npx supabase db reset', { stdio: ['ignore', 'ignore', 'inherit'] })
  await waitFor(`${apiUrl}/auth/v1/health`, { apikey: publishableKey })
  await waitFor(`${apiUrl}/rest/v1/`, { apikey: publishableKey })

  const admin = { username: 'root.admin', password: `Adm1n-${randomBytes(12).toString('base64url')}` }
  const response = await fetch(`${apiUrl}/functions/v1/bootstrap-admin`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: setupToken, username: admin.username, displayName: 'Root Administrator', password: admin.password }),
  })
  if (response.status !== 201) {
    throw new Error(`bootstrap-admin returned ${response.status}: ${await response.text()}`)
  }

  const signIn = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${admin.username}@${authEmailDomain}`, password: admin.password }),
  })
  const session = (await signIn.json()) as { user?: { id: string } }
  if (!session.user) throw new Error('The bootstrapped administrator could not sign in.')

  project.provide('supabase', {
    apiUrl,
    dbUrl: read('DB_URL'),
    publishableKey,
    secretKey: read('SECRET_KEY'),
    authEmailDomain,
    admin: { ...admin, id: session.user.id },
  })
}
