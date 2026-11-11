import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * Messages for errors raised on purpose by the database (identified by the
 * `hint` our functions set) or by PostgREST. Everything unrecognised becomes
 * a generic message: users never see SQL, stack traces or internal ids.
 */
const HINT_MESSAGES: Record<string, string> = {
  parent_archived: 'The parent item is archived. Restore it before adding to it.',
  export_generated: 'A generated report cannot be changed.',
  not_admin: 'Only an active administrator can do this.',
  last_admin: 'This would leave no active administrator.',
  reference_taken: 'A protocol with this reference already exists.',
  not_allowed: 'You do not have permission to do this.',
  setup_done: 'Setup has already been completed.',
}

const GENERIC = 'Something went wrong. Try again; if it keeps happening, tell your administrator.'

interface PostgrestLikeError {
  code?: string
  hint?: string | null
  message?: string
}

export function toUserMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return GENERIC
  const e = error as PostgrestLikeError
  if (e.hint && HINT_MESSAGES[e.hint]) return HINT_MESSAGES[e.hint]!
  switch (e.code) {
    case '42501':
      return 'You do not have permission to do this.'
    case '23505':
      return 'An item with the same identifying value already exists.'
    case '23514':
      return 'One of the values is not allowed. Check the form and try again.'
    case 'PGRST116':
      return 'The item was not found, or you do not have access to it.'
  }
  if (e.message === 'Failed to fetch' || e.message?.includes('NetworkError')) {
    return 'The server could not be reached. Check your connection and try again.'
  }
  return GENERIC
}

/**
 * Edge Functions return `{ error, code }` with a user-safe message. Reads it
 * from a failed `functions.invoke` call.
 */
export async function functionErrorMessage(error: unknown): Promise<{ message: string; code?: string }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: unknown; code?: unknown }
      if (typeof body.error === 'string') {
        return { message: body.error, code: typeof body.code === 'string' ? body.code : undefined }
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return { message: toUserMessage(error) }
}
