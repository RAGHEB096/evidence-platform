import type { EvidenceRow } from '@/features/evidence/api'
import type { ChapterNode, FunctionNode, StepNode, TestRunNode } from '@/features/protocols/tree'

export interface SelectionItem {
  evidence_id: string
  position: number
  caption_override: string | null
}

export interface ReportImage {
  evidence: EvidenceRow
  /** Sequential through the whole document, from 1. */
  number: number
  caption: string
}

export interface ReportStep {
  node: StepNode
  depth: number
  images: ReportImage[]
}

export interface ReportRun {
  node: TestRunNode
  /** Evidence attached to the test run as a whole. */
  images: ReportImage[]
  steps: ReportStep[]
}

export interface ReportFunction {
  node: FunctionNode
  runs: ReportRun[]
}

export interface ReportChapter {
  node: ChapterNode
  functions: ReportFunction[]
}

export interface ReportCounts {
  chapters: number
  testRuns: number
  steps: number
  images: number
}

export interface ReportModel {
  chapters: ReportChapter[]
  counts: ReportCounts
}

/**
 * What the Word report contains (SPEC 4.7):
 * - only selected evidence that is still live, in selection order within each step;
 * - a chapter, function, test run or step appears if it contains selected
 *   evidence (a parent step also appears when a sub-step does), or always
 *   when `includeStepsWithoutEvidence` is on;
 * - headings keep the protocol's own numbering, so the report traces back to the app;
 * - evidence is numbered 1, 2, 3… through the document.
 */
export function buildReportModel(input: {
  tree: ChapterNode[]
  evidence: EvidenceRow[]
  items: SelectionItem[]
  includeStepsWithoutEvidence: boolean
}): ReportModel {
  const selected = new Map(input.items.map((item) => [item.evidence_id, item]))
  const byRun = new Map<string, EvidenceRow[]>()
  const byStep = new Map<string, EvidenceRow[]>()
  for (const row of input.evidence) {
    if (row.deleted_at || !selected.has(row.id)) continue
    const bucket = row.test_step_id ? byStep : byRun
    const key = row.test_step_id ?? row.test_run_id
    bucket.set(key, [...(bucket.get(key) ?? []), row])
  }
  const order = (rows: EvidenceRow[]) =>
    [...rows].sort((a, b) => selected.get(a.id)!.position - selected.get(b.id)!.position || a.uploaded_at.localeCompare(b.uploaded_at))

  let imageNumber = 0
  const counts: ReportCounts = { chapters: 0, testRuns: 0, steps: 0, images: 0 }
  const include = input.includeStepsWithoutEvidence

  const toImages = (rows: EvidenceRow[]): ReportImage[] =>
    order(rows).map((evidence) => {
      imageNumber += 1
      const override = selected.get(evidence.id)!.caption_override
      return { evidence, number: imageNumber, caption: (override ?? evidence.caption).trim() }
    })

  // Steps are walked depth-first; a step is kept if it has images, a kept
  // descendant, or the include option is on. Images are numbered in document order.
  const walkSteps = (steps: StepNode[], depth: number): ReportStep[] =>
    steps.flatMap((node) => {
      const images = toImages(byStep.get(node.row.id) ?? [])
      const children = walkSteps(node.children, depth + 1)
      if (!include && images.length === 0 && children.length === 0) return []
      return [{ node, depth, images }, ...children]
    })

  const chapters: ReportChapter[] = []
  for (const chapter of input.tree) {
    const functions: ReportFunction[] = []
    for (const fn of chapter.functions) {
      const runs: ReportRun[] = []
      for (const run of fn.testRuns) {
        const images = toImages(byRun.get(run.row.id) ?? [])
        const steps = walkSteps(run.steps, 0)
        if (!include && images.length === 0 && steps.length === 0) continue
        runs.push({ node: run, images, steps })
      }
      if (!include && runs.length === 0) continue
      functions.push({ node: fn, runs })
    }
    if (!include && functions.length === 0) continue
    chapters.push({ node: chapter, functions })
  }

  for (const chapter of chapters) {
    counts.chapters += 1
    for (const fn of chapter.functions) {
      for (const run of fn.runs) {
        counts.testRuns += 1
        counts.steps += run.steps.length
      }
    }
  }
  counts.images = imageNumber
  return { chapters, counts }
}
