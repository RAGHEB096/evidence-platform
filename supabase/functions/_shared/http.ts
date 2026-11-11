import { allowedOrigins } from './env.ts'

/**
 * An error whose message is safe to show to the user. Anything else is logged
 * and replaced with a generic message, so SQL, stack traces and internal ids
 * never reach the browser (SPEC 5).
 */
export class UserFacingError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin')
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

export function json(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })
}

/** Wraps a POST handler with CORS, method checks and error mapping. */
export function serve(name: string, handler: (request: Request) => Promise<Response>) {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }
    const origin = request.headers.get('Origin')
    if (origin && !allowedOrigins().includes(origin)) {
      return json(request, 403, { error: 'This origin is not allowed.', code: 'origin_not_allowed' })
    }
    if (request.method !== 'POST') {
      return json(request, 405, { error: 'Use POST.', code: 'method_not_allowed' })
    }
    try {
      return await handler(request)
    } catch (error) {
      if (error instanceof UserFacingError) {
        return json(request, error.status, { error: error.message, code: error.code })
      }
      console.error(`[${name}]`, error)
      return json(request, 500, {
        error: 'The server could not complete the request. Try again; if it keeps failing, tell your administrator.',
        code: 'internal',
      })
    }
  })
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new UserFacingError(400, 'The request body is not valid JSON.', 'invalid_body')
  }
}

/** Compares two secrets without leaking their contents through timing. */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const viewA = new Uint8Array(hashA)
  const viewB = new Uint8Array(hashB)
  let difference = 0
  for (let index = 0; index < viewA.length; index++) difference |= viewA[index]! ^ viewB[index]!
  return difference === 0
}
