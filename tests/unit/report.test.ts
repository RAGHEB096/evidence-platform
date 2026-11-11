// @vitest-environment node
import { readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import type { EvidenceRow } from '@/features/evidence/api'
import { buildProtocolTree, type ProtocolRows, type TestStepRow } from '@/features/protocols/tree'
import { buildReportDocument, fitImage, type ReportMeta } from '@/features/reports/docx-builder'
import { buildReportModel, type SelectionItem } from '@/features/reports/model'

const PNG = new Uint8Array(readFileSync('tests/fixtures/images/screenshot.png'))

/**
 * The same picture with a tEXt chunk naming the evidence, so each image is a
 * distinct (still valid) file: docx stores identical bytes only once.
 */
function distinctPng(label: string): Uint8Array {
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from(`id\0${label}`, 'latin1')])
  const chunk = Buffer.alloc(body.length + 8)
  chunk.writeUInt32BE(body.length - 4, 0)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), body.length + 4)
  const iend = PNG.length - 12
  return new Uint8Array(Buffer.concat([PNG.subarray(0, iend), chunk, PNG.subarray(iend)]))
}
const created = '2026-01-01T00:00:00Z'
const node = (id: string, position: number) => ({ id, protocol_id: 'p', position, created_at: created, deleted_at: null })
const step = (id: string, run: string, position: number, parent: string | null, description: string, status: TestStepRow['status'] = 'passed'): TestStepRow => ({
  ...node(id, position),
  test_run_id: run,
  parent_step_id: parent,
  reference: '',
  description,
  expected_result: `Expected for ${description}`,
  actual_result: `Actual for ${description}`,
  status,
  comments: '',
  executed_by: null,
  executed_at: null,
})

const rows: ProtocolRows = {
  chapters: [
    { ...node('c1', 1), title: 'SMT Line 1', description: '' },
    { ...node('c2', 2), title: 'Packaging', description: '' },
  ],
  functions: [
    { ...node('f1', 1), chapter_id: 'c1', title: 'Barcode Verification', description: '' },
    { ...node('f2', 1), chapter_id: 'c2', title: 'Label Printing', description: '' },
  ],
  testRuns: [
    { ...node('r1', 1), function_id: 'f1', reference: 'TR-001', title: 'Test Run 001', description: '' },
    { ...node('r2', 1), function_id: 'f2', reference: 'TR-002', title: 'Test Run 002', description: '' },
  ],
  steps: [
    step('s1', 'r1', 1, null, 'Open the application.'),
    step('s2', 'r1', 2, null, 'Log in.'),
    step('s2a', 'r1', 1, 's2', 'Enter the username.'),
    step('s3', 'r2', 1, null, 'Print a label.', 'not_started'),
  ],
}

let seq = 0
const evidence = (id: string, run: string, stepId: string | null, caption: string, extra: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id,
  protocol_id: 'p',
  chapter_id: run === 'r1' ? 'c1' : 'c2',
  function_id: run === 'r1' ? 'f1' : 'f2',
  test_run_id: run,
  test_step_id: stepId,
  storage_path: `p/${id}/file.png`,
  original_filename: `${id}.png`,
  mime_type: 'image/png',
  size_bytes: PNG.length,
  sha256: 'a'.repeat(64),
  width: 64,
  height: 48,
  caption,
  description: '',
  uploaded_by: 'u',
  uploaded_at: `2026-02-01T00:00:${String(++seq).padStart(2, '0')}Z`,
  deleted_at: null,
  ...extra,
})

const allEvidence = [
  evidence('e-run', 'r1', null, 'Run overview'),
  evidence('e-s1-b', 'r1', 's1', 'Second on step 1'),
  evidence('e-s1-a', 'r1', 's1', 'First on step 1'),
  evidence('e-sub', 'r1', 's2a', 'Username field'),
  evidence('e-unselected', 'r1', 's1', 'NOT SELECTED CAPTION'),
  evidence('e-archived', 'r1', 's1', 'ARCHIVED CAPTION', { deleted_at: '2026-03-01T00:00:00Z' }),
]

const items: SelectionItem[] = [
  { evidence_id: 'e-run', position: 1, caption_override: null },
  // Selection order differs from upload order on purpose.
  { evidence_id: 'e-s1-a', position: 1, caption_override: 'Screenshot showing the login page.' },
  { evidence_id: 'e-s1-b', position: 2, caption_override: null },
  { evidence_id: 'e-sub', position: 1, caption_override: null },
  { evidence_id: 'e-archived', position: 3, caption_override: null },
]

const meta: ReportMeta = {
  protocol: { name: 'MES qualification', reference: 'OQ-001', version: '1.0', status: 'Active', description: 'Functional qualification.', createdBy: 'Ada', createdAt: '1 Jan 2026' },
  generatedAt: '11 Nov 2026, 10:00 CET',
  generatedBy: 'Grace Hopper',
  pageSize: 'A4',
}

const tree = buildProtocolTree(rows)

describe('buildReportModel', () => {
  it('keeps only selected live evidence, in selection order, numbered through the document', () => {
    const model = buildReportModel({ tree, evidence: allEvidence, items, includeStepsWithoutEvidence: false })
    const run = model.chapters[0]!.functions[0]!.runs[0]!
    expect(run.images.map((image) => [image.number, image.evidence.id])).toEqual([[1, 'e-run']])
    expect(run.steps.map((s) => [s.node.number, s.images.map((image) => [image.number, image.caption])])).toEqual([
      ['1', [[2, 'Screenshot showing the login page.'], [3, 'Second on step 1']]],
      ['2', []], // shown as the parent of a sub-step with evidence
      ['2.1', [[4, 'Username field']]],
    ])
    expect(model.counts).toEqual({ chapters: 1, testRuns: 1, steps: 3, images: 4 })
  })

  it('includes everything when "include steps without evidence" is on', () => {
    const model = buildReportModel({ tree, evidence: allEvidence, items, includeStepsWithoutEvidence: true })
    expect(model.chapters.map((c) => c.node.row.title)).toEqual(['SMT Line 1', 'Packaging'])
    expect(model.counts).toEqual({ chapters: 2, testRuns: 2, steps: 4, images: 4 })
  })

  it('is empty when nothing is selected and the option is off', () => {
    expect(buildReportModel({ tree, evidence: allEvidence, items: [], includeStepsWithoutEvidence: false })).toEqual({
      chapters: [],
      counts: { chapters: 0, testRuns: 0, steps: 0, images: 0 },
    })
  })
})

describe('fitImage', () => {
  it('fits the printable width, preserving aspect ratio', () => {
    const size = fitImage(2000, 1000, 'A4')
    expect(size.width).toBeLessThanOrEqual(Math.round((11906 - 2 * 1134) / 15))
    expect(size.width / size.height).toBeCloseTo(2, 1)
  })

  it('caps tall images at two thirds of the page height', () => {
    expect(fitImage(400, 4000, 'A4').height).toBeLessThanOrEqual(Math.round((16838 * 2) / 3 / 15))
  })

  it('never enlarges small images', () => {
    expect(fitImage(64, 48, 'A4')).toEqual({ width: 64, height: 48 })
  })
})

describe('buildReportDocument', () => {
  let zip: JSZip
  let documentXml: string
  let progress: [number, number][]

  beforeAll(async () => {
    const model = buildReportModel({ tree, evidence: allEvidence, items, includeStepsWithoutEvidence: false })
    progress = []
    const doc = await buildReportDocument(
      model,
      meta,
      async (evidence) => ({ data: distinctPng(evidence.id), width: 64, height: 48 }),
      (done, total) => progress.push([done, total]),
    )
    zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    documentXml = await zip.file('word/document.xml')!.async('string')
  })

  const paragraphs = () =>
    [...documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => ({
      style: /<w:pStyle w:val="([^"]+)"/.exec(match[0])?.[1] ?? null,
      text: [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
    }))

  it('is a Word package with the main document, styles, header and footer', () => {
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']) expect(zip.file(part), part).not.toBeNull()
    expect(Object.keys(zip.files).some((name) => /^word\/header\d*\.xml$/.test(name))).toBe(true)
    expect(Object.keys(zip.files).some((name) => /^word\/footer\d*\.xml$/.test(name))).toBe(true)
  })

  it('follows the protocol hierarchy with built-in heading styles and numbering', () => {
    const headings = paragraphs().filter((p) => p.style && /^Heading\d$/.test(p.style))
    expect(headings.map((h) => [h.style, h.text])).toEqual([
      ['Heading1', 'Protocol information'],
      ['Heading2', 'Protocol details'],
      ['Heading2', 'Selection summary'],
      ['Heading1', '1. SMT Line 1'],
      ['Heading2', '1.1 Barcode Verification'],
      ['Heading3', '1.1.1 Test Run 001 (TR-001)'],
    ])
  })

  it('embeds exactly the selected images, numbered sequentially, with their captions', async () => {
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))
    expect(media).toHaveLength(4)
    const text = paragraphs().map((p) => p.text)
    expect(text.filter((t) => /^Evidence \d{3}$/.test(t))).toEqual(['Evidence 001', 'Evidence 002', 'Evidence 003', 'Evidence 004'])
    expect(text).toContain('Caption: Screenshot showing the login page.')
    expect(documentXml).not.toContain('NOT SELECTED CAPTION')
    expect(documentXml).not.toContain('ARCHIVED CAPTION')
    expect(documentXml).not.toContain('Packaging')
  })

  it('writes step details and the uppercase status', () => {
    const text = paragraphs().map((p) => p.text)
    expect(text).toContain('Step 1: Open the application.')
    expect(text).toContain('Expected result:\tExpected for Open the application.')
    expect(text).toContain('Actual result:\tActual for Open the application.')
    expect(text).toContain('Status:\tPASSED')
  })

  it('has the cover page details, A4 pages, chapter page breaks and "Page X of Y"', async () => {
    const text = paragraphs().map((p) => p.text)
    for (const expected of ['Evidence Platform', 'Test Evidence Report', 'MES qualification', 'Reference OQ-001 · Version 1.0', 'Generated:\t11 Nov 2026, 10:00 CET', 'Generated by:\tGrace Hopper']) {
      expect(text).toContain(expected)
    }
    expect(documentXml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/)
    expect(documentXml).toContain('<w:pageBreakBefore/>')
    const footer = await zip.file(Object.keys(zip.files).find((name) => /^word\/footer\d*\.xml$/.test(name))!)!.async('string')
    expect(footer).toMatch(/PAGE/)
    expect(footer).toMatch(/NUMPAGES/)
    const header = await zip.file(Object.keys(zip.files).find((name) => /^word\/header\d*\.xml$/.test(name))!)!.async('string')
    expect(header).toContain('Test Evidence Report — OQ-001')
  })

  it('reports progress once per image', () => {
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it('makes no compliance claim', () => {
    expect(documentXml).not.toMatch(/Part 11|GAMP|GxP|compliant|validated/i)
  })
})
