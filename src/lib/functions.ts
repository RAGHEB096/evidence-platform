import { functionErrorMessage } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase'

/** An error whose message is safe to show (it came from our own function or mapping). */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** Calls an Edge Function with the signed-in user's session; throws ActionError on failure. */
export async function invokeFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>(name, { body })
  if (error) {
    const { message, code } = await functionErrorMessage(error)
    throw new ActionError(message, code)
  }
  return data as T
}
