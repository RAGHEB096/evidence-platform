import { execSync } from 'node:child_process'

/**
 * Resets the local database so the run starts with no administrator and the
 * first-time setup flow can be exercised through the UI.
 */
export default async function globalSetup() {
  try {
    execSync('npx supabase status', { stdio: 'ignore' })
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start`, then rerun `npm run test:e2e`.')
  }
  execSync('npx supabase db reset', { stdio: ['ignore', 'ignore', 'inherit'] })

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch('http://127.0.0.1:54321/auth/v1/health')).status < 500) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Local Supabase did not come back after the reset.')
}
