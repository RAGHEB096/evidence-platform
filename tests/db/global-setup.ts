import { execSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'

export interface LocalSupabase {
  apiUrl: string
  dbUrl: string
  publishableKey: string
  secretKey: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase
  }
}

/**
 * Reads connection details from the running local stack, so the tests never
 * need keys in a file. Fails with instructions if the stack is not running;
 * there is no mock fallback.
 */
export default function setup(project: TestProject) {
  let output: string
  try {
    output = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start`, then rerun `npm run test:db`.')
  }

  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) values.set(match[1]!, match[2]!)
  }

  const read = (key: string) => {
    const value = values.get(key)
    if (!value) throw new Error(`\`supabase status\` did not report ${key}. Is the local stack healthy?`)
    return value
  }

  project.provide('supabase', {
    apiUrl: read('API_URL'),
    dbUrl: read('DB_URL'),
    publishableKey: read('PUBLISHABLE_KEY'),
    secretKey: read('SECRET_KEY'),
  })
}
