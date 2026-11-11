import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx'
import { STEP_STATUSES } from '@/domain/status'
import type { EvidenceRow } from '@/features/evidence/api'
import type { ReportCounts, ReportImage, ReportModel, ReportStep } from '@/features/reports/model'

/** Page sizes in twentieths of a point (twips). A4 is the default (SPEC 4.7). */
export const PAGE_SIZES = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
} as const
export type PageSizeName = keyof typeof PAGE_SIZES

const MARGIN = 1134 // 2 cm
const FONT = 'Arial'
const TWIPS_PER_PX = 15 // 1440 twips per inch / 96 px per inch

export interface ReportMeta {
  protocol: {
    name: string
    reference: string
    version: string
    status: string
    description: string
    createdBy: string
    createdAt: string
  }
  generatedAt: string
  generatedBy: string
  pageSize: PageSizeName
}

/** A PNG ready to embed, already scaled to the configured long-edge maximum. */
export interface PreparedImage {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Display size of an image: fits the printable width and at most two thirds of
 * the page height, never enlarged, aspect ratio preserved.
 */
export function fitImage(width: number, height: number, pageSize: PageSizeName): { width: number; height: number } {
  const page = PAGE_SIZES[pageSize]
  const maxWidth = (page.width - 2 * MARGIN) / TWIPS_PER_PX
  const maxHeight = ((page.height * 2) / 3) / TWIPS_PER_PX
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const statusText = (status: keyof typeof STEP_STATUSES) => STEP_STATUSES[status].label.toUpperCase()
const pad3 = (n: number) => String(n).padStart(3, '0')

function labelled(label: string, value: string, options: { bold?: boolean } = {}) {
  return new Paragraph({
    tabStops: [{ type: TabStopType.LEFT, position: 2200 }],
    spacing: { after: 40 },
    keepLines: true,
    children: [new TextRun({ text: `${label}:`, bold: true }), new TextRun({ text: `\t${value || '—'}`, bold: options.bold })],
  })
}

function infoTable(rows: [string, string][]) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
            new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [new Paragraph(value || '—')] }),
          ],
        }),
    ),
  })
}

function summaryRows(counts: ReportCounts): [string, string][] {
  return [
    ['Chapters', String(counts.chapters)],
    ['Test runs', String(counts.testRuns)],
    ['Steps', String(counts.steps)],
    ['Evidence images', String(counts.images)],
  ]
}

async function imageBlock(image: ReportImage, prepare: (evidence: EvidenceRow) => Promise<PreparedImage>, pageSize: PageSizeName): Promise<Paragraph[]> {
  const prepared = await prepare(image.evidence)
  const size = fitImage(prepared.width, prepared.height, pageSize)
  return [
    // Label, image and caption are kept together on one page.
    new Paragraph({ keepNext: true, keepLines: true, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: `Evidence ${pad3(image.number)}`, bold: true })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      keepLines: true,
      children: [
        new ImageRun({
          type: 'png',
          data: prepared.data,
          transformation: size,
          altText: { name: `Evidence ${pad3(image.number)}`, description: image.caption || image.evidence.original_filename, title: image.evidence.original_filename },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      keepLines: true,
      spacing: { before: 60 },
      children: [new TextRun({ text: 'Caption: ', bold: true }), new TextRun(image.caption || '—')],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepLines: true,
      spacing: { after: 200 },
      children: [new TextRun({ text: `Source file: ${image.evidence.original_filename} · SHA-256 ${image.evidence.sha256}`, size: 16, color: '595959' })],
    }),
  ]
}

function stepBlock(step: ReportStep): Paragraph[] {
  const row = step.node.row
  return [
    new Paragraph({
      keepNext: true,
      keepLines: true,
      spacing: { before: 200, after: 60 },
      indent: { left: step.depth * 360 },
      children: [new TextRun({ text: `Step ${step.node.number}: `, bold: true }), new TextRun(row.description)],
    }),
    labelled('Expected result', row.expected_result),
    labelled('Actual result', row.actual_result),
    labelled('Status', statusText(step.status), { bold: true }),
    ...(row.comments ? [labelled('Comments', row.comments)] : []),
  ]
}

/**
 * Builds the report document (SPEC 4.7). `prepare` fetches and converts one
 * image at a time; `onImage` reports progress after each one.
 */
export async function buildReportDocument(
  model: ReportModel,
  meta: ReportMeta,
  prepare: (evidence: EvidenceRow) => Promise<PreparedImage>,
  onImage: (done: number, total: number) => void = () => {},
): Promise<Document> {
  const page = PAGE_SIZES[meta.pageSize]
  const pageProperties = { size: { width: page.width, height: page.height }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 567, footer: 567 } }
  const title = `Test Evidence Report — ${meta.protocol.reference}`
  let done = 0
  const total = model.counts.images
  const images = async (list: ReportImage[]) => {
    const blocks: Paragraph[] = []
    for (const image of list) {
      blocks.push(...(await imageBlock(image, prepare, meta.pageSize)))
      done += 1
      onImage(done, total)
    }
    return blocks
  }

  const cover = [
    new Paragraph({ spacing: { before: 2400, after: 240 }, children: [new TextRun({ text: 'Evidence Platform', size: 28, color: '595959' })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 480 }, children: [new TextRun({ text: 'Test Evidence Report', size: 56, bold: true })] }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: meta.protocol.name, size: 32, bold: true })] }),
    new Paragraph({ spacing: { after: 480 }, children: [new TextRun({ text: `Reference ${meta.protocol.reference} · Version ${meta.protocol.version}`, size: 24 })] }),
    labelled('Generated', meta.generatedAt),
    labelled('Generated by', meta.generatedBy),
  ]

  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Protocol information')] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun(meta.protocol.description || 'No description.')] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Protocol details')] }),
    infoTable([
      ['Name', meta.protocol.name],
      ['Reference', meta.protocol.reference],
      ['Version', meta.protocol.version],
      ['Status', meta.protocol.status],
      ['Created by', meta.protocol.createdBy],
      ['Created', meta.protocol.createdAt],
    ]),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun('Selection summary')] }),
    infoTable(summaryRows(model.counts)),
  ]

  for (const chapter of model.chapters) {
    // Each chapter starts on a new page; nothing else forces breaks, so no blank pages.
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(`${chapter.node.number}. ${chapter.node.row.title}`)] }))
    for (const fn of chapter.functions) {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(`${fn.node.number} ${fn.node.row.title}`)] }))
      for (const run of fn.runs) {
        const reference = run.node.row.reference ? ` (${run.node.row.reference})` : ''
        body.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun(`${run.node.number} ${run.node.row.title}${reference}`)] }))
        body.push(...(await images(run.images)))
        for (const step of run.steps) {
          body.push(...stepBlock(step))
          body.push(...(await images(step.images)))
        }
      }
    }
  }

  const headingStyle = (size: number) => ({ run: { font: FONT, size, bold: true, color: '1F1F1F' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } })

  return new Document({
    creator: meta.generatedBy,
    title,
    description: `Test evidence report for ${meta.protocol.reference}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } },
        heading1: headingStyle(32),
        heading2: headingStyle(26),
        heading3: headingStyle(23),
        title: { run: { font: FONT } },
      },
    },
    sections: [
      { properties: { page: pageProperties }, children: cover },
      {
        properties: { page: pageProperties, type: SectionType.NEXT_PAGE },
        headers: {
          default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: title, size: 16, color: '595959' })] })] }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ size: 16, color: '595959', children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  })
}
