import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { envResult } from '@/lib/env'

let client: SupabaseClient | undefined

/**
 * The single browser client. It carries the publishable key plus the
 * signed-in user's JWT, so every request is filtered by RLS (ADR-003).
 */
export function getSupabase(): SupabaseClient {
  if (!envResult.ok) {
    throw new Error('Supabase is not configured: ' + envResult.problems.join('; '))
  }
  client ??= createClient(envResult.env.VITE_SUPABASE_URL, envResult.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}
