import { storageFileName, validateImageFile } from '@shared/image-format.ts'
import { envResult } from '@/lib/env'
import { ActionError, invokeFunction } from '@/lib/functions'
import { getSupabase } from '@/lib/supabase'

export interface UploadTarget {
  protocolId: string
  testRunId: string
  testStepId: string | null
}

const FINALIZE_ATTEMPTS = 4

export type UploadPhase = 'checking' | 'rejected' | 'queued' | 'uploading' | 'verifying' | 'done' | 'failed'

/** Client-side check before any byte leaves the browser. Returns null when the file is acceptable. */
export async function checkFile(file: File, maxBytes: number): Promise<string | null> {
  // Read at most a little over the limit; an oversized file fails on size anyway.
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, maxBytes + 1)).arrayBuffer())
  const result = validateImageFile({ name: file.name, type: file.type, size: file.size, bytes, maxBytes })
  return result.ok ? null : `${file.name} ${result.reason}.`
}

/**
 * Sends one file straight to the private bucket with progress events
 * (supabase-js has no upload progress), then asks finalize-evidence to verify,
 * hash and register it. Throws ActionError with a message naming the file.
 */
export async function uploadEvidence(file: File, target: UploadTarget, onProgress: (fraction: number) => void, onVerifying: () => void): Promise<string> {
  if (!envResult.ok) throw new ActionError('The application is not configured.')
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ActionError('Your session has ended. Sign in again.')

  const evidenceId = crypto.randomUUID()
  const storagePath = `${target.protocolId}/${evidenceId}/${storageFileName(file.name)}`
  const url = `${envResult.env.VITE_SUPABASE_URL}/storage/v1/object/evidence/${storagePath.split('/').map(encodeURIComponent).join('/')}`

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', envResult.ok ? envResult.env.VITE_SUPABASE_PUBLISHABLE_KEY : '')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      reject(
        new ActionError(
          xhr.status === 413
            ? `${file.name} is larger than the storage limit.`
            : xhr.status === 403 || xhr.status === 400
              ? `${file.name} was refused by storage. Check that you may add evidence to this protocol.`
              : `${file.name} could not be uploaded. Try again.`,
        ),
      )
    }
    xhr.onerror = () => reject(new ActionError(`${file.name} could not be uploaded: the server could not be reached.`))
    xhr.send(file)
  })

  onProgress(1)
  onVerifying()
  const body = { evidenceId, testRunId: target.testRunId, testStepId: target.testStepId, storagePath, originalFilename: file.name }
  await finalizeWithRetry(() => invokeFunction('finalize-evidence', body))
  return evidenceId
}

/**
 * The function runtime can answer 5xx under load (seen locally as 503).
 * Finalisation is safe to repeat: if an earlier attempt registered the file
 * but its answer was lost, a retry reports already_registered, which counts
 * as success. Other errors (invalid image, no permission) are not retried.
 */
export async function finalizeWithRetry(call: () => Promise<unknown>, delayMs = 500): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await call()
      return
    } catch (error) {
      if (attempt > 1 && error instanceof ActionError && error.code === 'already_registered') return
      const transient = error instanceof ActionError && (error.status === 0 || (error.status ?? 0) >= 500)
      if (!transient || attempt >= FINALIZE_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)))
    }
  }
}
