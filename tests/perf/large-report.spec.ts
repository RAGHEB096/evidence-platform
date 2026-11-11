import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { adminApi } from '../e2e/support'

/**
 * Not part of `npm run test:e2e`. Run with `npm run test:perf`: it shares the
 * E2E build, database reset and first-time setup, then builds a protocol with
 * many distinct full-HD screenshots, generates the report in the browser, and
 * prints timings and sizes. PERF_IMAGES sets the count (default 300).
 */
const IMAGES = Number(process.env.PERF_IMAGES ?? 300)
const CHAPTERS = 5
const PER_STEP = 10
const suffix = Date.now().toString(36)

/** A screenshot-like 1920×1080 PNG (UI chrome, a table of text, the index), different for every index. */
async function screenshot(page: Page, index: number): Promise<Buffer> {
  const base64 = await page.evaluate(async (n) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1920
    canvas.height = 1080
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, 1920, 1080)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, 1920, 64)
    ctx.fillRect(0, 64, 280, 1016)
    ctx.fillStyle = '#f8fafc'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText(`MES — Screen ${n}`, 24, 42)
    ctx.font = '18px sans-serif'
    for (let row = 0; row < 40; row++) {
      ctx.fillStyle = row % 2 ? '#e2e8f0' : '#ffffff'
      ctx.fillRect(320, 100 + row * 24, 1560, 24)
      ctx.fillStyle = '#0f172a'
      ctx.fillText(`Order ${n * 100 + row}   Station SMT-${(n + row) % 7}   Barcode 40063813${n}${row}   Qty ${(n * 37 + row * 11) % 500}   OK`, 330, 118 + row * 24)
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }, index)
  return Buffer.from(base64, 'base64')
}

test(`a report with ${IMAGES} full-HD screenshots`, async ({ page }) => {
  test.setTimeout(30 * 60_000)
  const api = await adminApi()
  await page.goto('/')

  // Arrange: CHAPTERS chapters with one test run each; images spread evenly, PER_STEP per step.
  const { data: protocolId, error } = await api.rpc('create_protocol', { p_reference: `PERF-${suffix}`.toUpperCase(), p_name: `Large report ${IMAGES}` })
  if (error) throw error
  const insert = async (table: string, row: Record<string, unknown>) => (await api.from(table).insert(row).select('id').single()).data!.id as string
  const perChapter = Math.ceil(IMAGES / CHAPTERS)
  const steps: { runId: string; stepId: string }[][] = []
  for (let c = 0; c < CHAPTERS; c++) {
    const chapter = await insert('chapters', { protocol_id: protocolId, title: `Station ${c + 1}` })
    const fn = await insert('functions', { protocol_id: protocolId, chapter_id: chapter, title: 'Scanning' })
    const run = await insert('test_runs', { protocol_id: protocolId, function_id: fn, title: `Run ${c + 1}` })
    steps.push([])
    for (let s = 0; s < Math.ceil(perChapter / PER_STEP); s++) {
      steps[c]!.push({ runId: run, stepId: await insert('test_steps', { protocol_id: protocolId, test_run_id: run, description: `Scan batch ${s + 1}.` }) })
    }
  }

  let sourceBytes = 0
  let retries = 0
  const uploadStart = Date.now()
  for (let start = 0; start < IMAGES; start += 8) {
    const batch = Array.from({ length: Math.min(8, IMAGES - start) }, (_, k) => start + k)
    const pictures: Buffer[] = []
    for (const index of batch) pictures.push(await screenshot(page, index))
    await Promise.all(
      batch.map(async (index, k) => {
        const bytes = pictures[k]!
        sourceBytes += bytes.length
        const chapter = index % CHAPTERS
        const target = steps[chapter]![Math.floor(Math.floor(index / CHAPTERS) / PER_STEP)]!
        const evidenceId = crypto.randomUUID()
        const storagePath = `${protocolId}/${evidenceId}/screen-${index}.png`
        const { error: uploadError } = await api.storage.from('evidence').upload(storagePath, bytes, { contentType: 'image/png' })
        if (uploadError) throw uploadError
        // Same retry policy as the app (finalizeWithRetry): transient 5xx are retried.
        for (let attempt = 1; ; attempt++) {
          const { error: finalizeError } = await api.functions.invoke('finalize-evidence', {
            body: { evidenceId, testRunId: target.runId, testStepId: target.stepId, storagePath, originalFilename: `screen-${index}.png`, caption: `Screen ${index}` },
          })
          if (!finalizeError) break
          const context = (finalizeError as { context?: Response }).context
          const body = context ? await context.text() : ''
          if (attempt > 1 && body.includes('already_registered')) break
          if (!context || context.status < 500 || attempt >= 4) {
            throw new Error(`finalize-evidence for image ${index}: ${context ? `${context.status} ${body}` : finalizeError.message}`)
          }
          retries += 1
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
        }
      }),
    )
  }
  const uploadSeconds = (Date.now() - uploadStart) / 1000

  // Select everything and generate.
  await page.goto(`/protocols/${protocolId}/report`)
  for (let c = 1; c <= CHAPTERS; c++) {
    const all = page.getByRole('region', { name: `Chapter ${c} Station ${c}` }).getByRole('checkbox', { name: /All in chapter/ })
    await all.click({ timeout: 30_000 })
    await expect(all).toBeChecked()
  }
  const summary = page.getByRole('complementary', { name: 'Report summary' })
  await expect(summary.locator('dd').nth(3)).toHaveText(String(IMAGES), { timeout: 30_000 })

  const generateStart = Date.now()
  const download = page.waitForEvent('download', { timeout: 25 * 60_000 })
  await summary.getByRole('button', { name: 'Generate Word report' }).click()
  const file = await download
  const generateSeconds = (Date.now() - generateStart) / 1000
  const path = test.info().outputPath('large-report.docx')
  await file.saveAs(path)
  const bytes = readFileSync(path)
  const zip = await JSZip.loadAsync(bytes)
  const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/')).length
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)

  console.log(
    'PERF',
    JSON.stringify({
      images: IMAGES,
      averageSourceKb: Math.round(sourceBytes / IMAGES / 1024),
      uploadAndFinalizeSeconds: uploadSeconds,
      finalizeRetries: retries,
      generateSeconds,
      docxMb: Math.round((bytes.length / 1024 / 1024) * 10) / 10,
      embeddedMedia: media,
      jsHeapAfterMb: Math.round(heap / 1024 / 1024),
    }),
  )
  expect(media).toBe(IMAGES)
})
