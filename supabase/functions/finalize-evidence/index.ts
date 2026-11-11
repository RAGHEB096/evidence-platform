// Verifies an uploaded evidence file, hashes it and registers it (ADR-004).
// Only this function creates evidence_files rows.
//
// It removes an object it rejects, but only when the caller uploaded it and
// no evidence row points to it: a registered original is never touched.

import { adminClient, parseOrThrow } from '../_shared/accounts.ts'
import { requireCaller, rpcError } from '../_shared/caller.ts'
import { z } from '../_shared/deps.ts'
import { json, readJson, serve, UserFacingError } from '../_shared/http.ts'
import { validateImageFile } from '../_shared/image-format.ts'

const bodySchema = z.object({
  evidenceId: z.uuid(),
  testRunId: z.uuid(),
  testStepId: z.uuid().nullable().default(null),
  storagePath: z.string().max(300),
  originalFilename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) => !/[\\/\u0000-\u001f]/.test(name), 'The file name contains characters that are not allowed.'),
  caption: z.string().max(500).default(''),
})

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

serve('finalize-evidence', async (request) => {
  const admin = adminClient()
  const caller = await requireCaller(request, admin)
  const body = parseOrThrow(bodySchema, await readJson(request))
  const name = body.originalFilename

  const { data: run, error: runError } = await admin.from('test_runs').select('id, protocol_id').eq('id', body.testRunId).maybeSingle()
  if (runError) throw runError
  if (!run) throw new UserFacingError(404, 'The test run was not found.', 'not_found')

  const expectedPrefix = `${run.protocol_id}/${body.evidenceId}/`
  const fileSegment = body.storagePath.slice(expectedPrefix.length)
  if (!body.storagePath.startsWith(expectedPrefix) || !/^[A-Za-z0-9._-]{1,100}$/.test(fileSegment)) {
    throw new UserFacingError(400, `${name} was uploaded to an unexpected location.`, 'invalid_path')
  }

  const { data: allowed, error: roleError } = await admin.rpc('svc_check_protocol_role', {
    p_actor: caller.id,
    p_protocol: run.protocol_id,
    p_min: 'tester',
  })
  if (roleError) throw roleError
  if (!allowed) throw new UserFacingError(403, 'You do not have permission to add evidence to this protocol.', 'not_allowed')

  const { data: objects, error: objectError } = await admin.rpc('svc_evidence_object', { p_path: body.storagePath })
  if (objectError) throw objectError
  const object = (objects as { owner_id: string | null; size_bytes: number; mime_type: string | null; registered: boolean }[])[0]
  if (!object) throw new UserFacingError(404, `${name} was not found in storage. Upload it again.`, 'upload_missing')
  if (object.registered) throw new UserFacingError(409, `${name} is already registered.`, 'already_registered')
  if (object.owner_id !== caller.id) throw new UserFacingError(403, `${name} was uploaded by someone else.`, 'not_owner')

  // From here on the object is the caller's own, unregistered upload.
  const reject = async (status: number, message: string, code: string): Promise<never> => {
    const { error } = await admin.storage.from('evidence').remove([body.storagePath])
    if (error) console.error('[finalize-evidence] could not remove rejected upload', body.storagePath, error)
    throw new UserFacingError(status, message, code)
  }

  const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'upload_limit_bytes').single()
  const maxBytes = Number(setting?.value ?? 20 * 1024 * 1024)
  if (object.size_bytes > maxBytes) {
    await reject(422, `${name} is larger than the ${Math.round(maxBytes / 104857.6) / 10} MB limit.`, 'too_large')
  }

  const { data: blob, error: downloadError } = await admin.storage.from('evidence').download(body.storagePath)
  if (downloadError || !blob) throw downloadError ?? new Error('download returned nothing')
  const bytes = new Uint8Array(await blob.arrayBuffer())

  const checked = validateImageFile({ name, type: object.mime_type ?? '', size: bytes.length, bytes, maxBytes })
  if (!checked.ok) await reject(422, `${name} ${checked.reason}.`, 'invalid_image')
  const info = (checked as Extract<typeof checked, { ok: true }>).info

  const { error: registerError } = await admin.rpc('svc_register_evidence', {
    p_actor: caller.id,
    p_id: body.evidenceId,
    p_test_run_id: body.testRunId,
    p_test_step_id: body.testStepId,
    p_storage_path: body.storagePath,
    p_original_filename: name,
    p_mime_type: info.mime,
    p_size_bytes: bytes.length,
    p_sha256: await sha256Hex(bytes),
    p_width: info.width,
    p_height: info.height,
    p_caption: body.caption,
  })
  if (registerError) {
    const mapped = registerError.hint === 'archived'
      ? new UserFacingError(409, `${name} could not be added: the step or test run is archived.`, 'archived')
      : registerError.hint === 'step_mismatch'
        ? new UserFacingError(400, `${name} could not be added: the step does not belong to this test run.`, 'step_mismatch')
        : rpcError(registerError)
    const { error } = await admin.storage.from('evidence').remove([body.storagePath])
    if (error) console.error('[finalize-evidence] could not remove unregistered upload', body.storagePath, error)
    throw mapped
  }

  return json(request, 201, { id: body.evidenceId, width: info.width, height: info.height, mime: info.mime })
})
