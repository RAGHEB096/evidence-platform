import type { StepStatus } from '@/domain/status'

export type NodeType = 'chapter' | 'function' | 'test_run' | 'test_step'

interface NodeRowBase {
  id: string
  protocol_id: string
  position: number
  created_at: string
  deleted_at: string | null
}

export interface ChapterRow extends NodeRowBase {
  title: string
  description: string
}

export interface FunctionRow extends NodeRowBase {
  chapter_id: string
  title: string
  description: string
}

export interface TestRunRow extends NodeRowBase {
  function_id: string
  reference: string
  title: string
  description: string
}

export interface TestStepRow extends NodeRowBase {
  test_run_id: string
  parent_step_id: string | null
  reference: string
  description: string
  expected_result: string
  actual_result: string
  status: StepStatus
  comments: string
  executed_by: string | null
  executed_at: string | null
}

export interface ProtocolRows {
  chapters: ChapterRow[]
  functions: FunctionRow[]
  testRuns: TestRunRow[]
  steps: TestStepRow[]
}

/** `number` is the outline number ("1.2.3"); null for archived nodes, which are not counted. */
export interface StepNode {
  type: 'test_step'
  row: TestStepRow
  number: string | null
  children: StepNode[]
}

export interface TestRunNode {
  type: 'test_run'
  row: TestRunRow
  number: string | null
  steps: StepNode[]
}

export interface FunctionNode {
  type: 'function'
  row: FunctionRow
  number: string | null
  testRuns: TestRunNode[]
}

export interface ChapterNode {
  type: 'chapter'
  row: ChapterRow
  number: string | null
  functions: FunctionNode[]
}

export type TreeNode = ChapterNode | FunctionNode | TestRunNode | StepNode

/** Siblings are ordered by position; ties (never expected) fall back to creation time, then id. */
export function byPosition<T extends NodeRowBase>(a: T, b: T): number {
  return a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  for (const list of groups.values()) list.sort(byPosition as (a: T, b: T) => number)
  return groups
}

/**
 * Numbers the live members of a sibling list 1, 2, 3… after `prefix`.
 * Archived members get null and do not take a number.
 */
function numbered<T extends NodeRowBase>(rows: T[], prefix: string): { row: T; number: string | null }[] {
  let count = 0
  return rows.map((row) => {
    if (row.deleted_at) return { row, number: null }
    count += 1
    return { row, number: prefix ? `${prefix}.${count}` : String(count) }
  })
}

export function buildProtocolTree(rows: ProtocolRows, options: { includeArchived?: boolean } = {}): ChapterNode[] {
  const keep = <T extends NodeRowBase>(list: T[]) => (options.includeArchived ? list : list.filter((row) => !row.deleted_at))
  const functionsByChapter = groupBy(keep(rows.functions), (row) => row.chapter_id)
  const runsByFunction = groupBy(keep(rows.testRuns), (row) => row.function_id)
  const stepsByRun = groupBy(
    keep(rows.steps).filter((row) => row.parent_step_id === null),
    (row) => row.test_run_id,
  )
  const stepsByParent = groupBy(
    keep(rows.steps).filter((row) => row.parent_step_id !== null),
    (row) => row.parent_step_id,
  )

  const buildSteps = (list: TestStepRow[], prefix: string, parentArchived: boolean): StepNode[] =>
    numbered(list, prefix).map(({ row, number }) => {
      const effective = parentArchived ? null : number
      return {
        type: 'test_step',
        row,
        number: effective,
        children: buildSteps(stepsByParent.get(row.id) ?? [], effective ?? '', effective === null),
      }
    })

  return numbered([...keep(rows.chapters)].sort(byPosition), '').map(({ row: chapter, number: chapterNumber }) => ({
    type: 'chapter',
    row: chapter,
    number: chapterNumber,
    functions: numbered(functionsByChapter.get(chapter.id) ?? [], chapterNumber ?? '').map(({ row: fn, number: fnNumber }) => {
      const functionNumber = chapterNumber === null ? null : fnNumber
      return {
        type: 'function',
        row: fn,
        number: functionNumber,
        testRuns: numbered(runsByFunction.get(fn.id) ?? [], functionNumber ?? '').map(({ row: run, number: runNumber }) => {
          const testRunNumber = functionNumber === null ? null : runNumber
          return {
            type: 'test_run',
            row: run,
            number: testRunNumber,
            steps: buildSteps(stepsByRun.get(run.id) ?? [], '', testRunNumber === null),
          }
        }),
      }
    }),
  }))
}

/** Children of a node in display order. */
export function childrenOf(node: TreeNode): TreeNode[] {
  switch (node.type) {
    case 'chapter':
      return node.functions
    case 'function':
      return node.testRuns
    case 'test_run':
      return node.steps
    case 'test_step':
      return node.children
  }
}

/** Moves one item and returns a new array; out-of-range moves return the input unchanged. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/** Every step in a run, depth-first in display order. */
export function flattenSteps(steps: StepNode[]): StepNode[] {
  return steps.flatMap((step) => [step, ...flattenSteps(step.children)])
}

/**
 * A test run's status, derived from its live steps (SPEC 4.4: not stored).
 * Failed beats Blocked beats In Progress; a run is Passed when every step has
 * a final status and at least one passed.
 */
export function deriveRunStatus(statuses: readonly StepStatus[]): StepStatus {
  if (statuses.length === 0) return 'not_started'
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.every((status) => status === 'not_applicable')) return 'not_applicable'
  if (statuses.every((status) => status === 'passed' || status === 'not_applicable')) return 'passed'
  if (statuses.every((status) => status === 'not_started')) return 'not_started'
  return 'in_progress'
}

export const NODE_LABELS: Record<NodeType, string> = {
  chapter: 'Chapter',
  function: 'Function',
  test_run: 'Test run',
  test_step: 'Step',
}

export const CHILD_TYPE: Record<NodeType, NodeType> = {
  chapter: 'function',
  function: 'test_run',
  test_run: 'test_step',
  test_step: 'test_step',
}
