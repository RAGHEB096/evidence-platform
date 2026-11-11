import { SIGNED_URL_TTL_SECONDS } from '@/config'
import type { EvidenceRow } from '@/features/evidence/api'
import type { PageSizeName, PreparedImage, ReportMeta } from '@/features/reports/docx-builder'
import type { ReportModel } from '@/features/reports/model'
import { getSupabase } from '@/lib/supabase'

export type GenerationPhase = 'images' | 'packing' | 'saving' | 'recording'

export interface GenerationProgress {
  phase: GenerationPhase
  done: number
  total: number
}

const URL_BATCH = 25

/**
 * Decodes an original (GIF: first frame), scales its long edge down to
 * `longEdge` and re-encodes it as PNG (ADR-005). The original is untouched.
 */
async function toPng(blob: Blob, longEdge: number): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(bitmap, 0, 0, width, height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))), 'image/png'))
    return { data: new Uint8Array(await png.arrayBuffer()), width, height }
  } finally {
    bitmap.close()
  }
}

/**
 * Hands out signed URLs a batch at a time, so a long generation never uses an
 * expired URL (they live SIGNED_URL_TTL_SECONDS).
 */
function signedUrlSource(paths: string[]) {
  const cache = new Map<string, { url: string; expires: number }>()
  return async (path: string): Promise<string> => {
    const hit = cache.get(path)
    if (hit && hit.expires > Date.now()) return hit.url
    const start = paths.indexOf(path)
    const batch = paths.slice(start, start + URL_BATCH)
    const { data, error } = await getSupabase().storage.from('evidence').createSignedUrls(batch, SIGNED_URL_TTL_SECONDS)
    if (error) throw error
    const expires = Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000
    for (const item of data) if (item.path && item.signedUrl) cache.set(item.path, { url: item.signedUrl, expires })
    const url = cache.get(path)?.url
    if (!url) throw new Error(`No signed URL for ${path}`)
    return url
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function reportFileName(reference: string, generatedAt: Date): string {
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')} ${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}`
  return `${reference} Test Evidence Report ${stamp}.docx`.replace(/[\\/:*?"<>|]+/g, '_')
}

/** "11 November 2026, 14:05 Central European Standard Time (Europe/Paris)" */
export function formatGeneratedAt(date: Date): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const text = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(date)
  const zoneName = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'long' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value
  return `${text} ${zoneName ?? ''} (${zone})`.replace(/\s+/g, ' ').trim()
}

export interface GenerateOptions {
  exportId: string
  protocolId: string
  reference: string
  model: ReportModel
  meta: Omit<ReportMeta, 'generatedAt' | 'pageSize'>
  pageSize: PageSizeName
  longEdge: number
  saveCopy: boolean
  onProgress: (progress: GenerationProgress) => void
}

/**
 * Builds the .docx in the browser (ADR-005), optionally stores it in the
 * private exports bucket, records the export server-side (ADR-006), and
 * returns the file for download.
 */
export async function generateReport(options: GenerateOptions): Promise<{ blob: Blob; fileName: string }> {
  const [{ buildReportDocument }, { Packer }] = await Promise.all([import('@/features/reports/docx-builder'), import('docx')])
  const generatedAt = new Date()
  const total = options.model.counts.images
  options.onProgress({ phase: 'images', done: 0, total })

  const images: EvidenceRow[] = options.model.chapters.flatMap((chapter) =>
    chapter.functions.flatMap((fn) => fn.runs.flatMap((run) => [...run.images, ...run.steps.flatMap((step) => step.images)].map((image) => image.evidence))),
  )
  const signedUrl = signedUrlSource(images.map((row) => row.storage_path))

  const prepare = async (evidence: EvidenceRow) => {
    const response = await fetch(await signedUrl(evidence.storage_path))
    if (!response.ok) throw new Error(`Could not fetch ${evidence.original_filename}`)
    try {
      return await toPng(await response.blob(), options.longEdge)
    } catch {
      throw new Error(`${evidence.original_filename} could not be decoded by this browser.`)
    }
  }

  const doc = await buildReportDocument(
    options.model,
    { ...options.meta, generatedAt: formatGeneratedAt(generatedAt), pageSize: options.pageSize },
    prepare,
    (done) => options.onProgress({ phase: 'images', done, total }),
  )

  options.onProgress({ phase: 'packing', done: total, total })
  const blob = await Packer.toBlob(doc)
  const sha256 = await sha256Hex(blob)
  const supabase = getSupabase()

  let storagePath: string | null = null
  if (options.saveCopy) {
    options.onProgress({ phase: 'saving', done: total, total })
    storagePath = `${options.protocolId}/${options.exportId}.docx`
    const { error } = await supabase.storage.from('exports').upload(storagePath, blob, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    })
    if (error) throw new Error('The report could not be saved to Generated Documents.')
  }

  options.onProgress({ phase: 'recording', done: total, total })
  const counts = options.model.counts
  const { error } = await supabase.rpc('finalize_export', {
    p_export_id: options.exportId,
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_file_size_bytes: blob.size,
    p_chapter_count: counts.chapters,
    p_test_run_count: counts.testRuns,
    p_step_count: counts.steps,
    p_image_count: counts.images,
  })
  if (error) throw error

  return { blob, fileName: reportFileName(options.reference, generatedAt) }
}

/** Starts a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
