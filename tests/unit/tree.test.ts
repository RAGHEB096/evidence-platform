import { describe, expect, it } from 'vitest'
import {
  buildProtocolTree,
  deriveRunStatus,
  effectiveStatus,
  flattenSteps,
  leafSteps,
  moveItem,
  type ChapterRow,
  type FunctionRow,
  type ProtocolRows,
  type TestRunRow,
  type TestStepRow,
} from '@/features/protocols/tree'

let seq = 0
const base = (position: number, deleted = false) => ({
  id: `id-${++seq}`,
  protocol_id: 'p',
  position,
  created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
  deleted_at: deleted ? '2026-02-01T00:00:00Z' : null,
})

const chapter = (position: number, title: string, deleted = false): ChapterRow => ({ ...base(position, deleted), title, description: '' })
const fn = (chapterId: string, position: number, title: string, deleted = false): FunctionRow => ({
  ...base(position, deleted),
  chapter_id: chapterId,
  title,
  description: '',
})
const run = (functionId: string, position: number, title: string): TestRunRow => ({
  ...base(position),
  function_id: functionId,
  reference: '',
  title,
  description: '',
})
const step = (runId: string, position: number, parent: string | null = null, deleted = false): TestStepRow => ({
  ...base(position, deleted),
  test_run_id: runId,
  parent_step_id: parent,
  reference: '',
  description: `step ${position}`,
  expected_result: '',
  actual_result: '',
  status: 'not_started',
  comments: '',
  executed_by: null,
  executed_at: null,
})

function fixture(): ProtocolRows {
  const c2 = chapter(2, 'Packaging')
  const c1 = chapter(1, 'SMT Line 1')
  const cArchived = chapter(3, 'Old line', true)
  const f1 = fn(c1.id, 1, 'Barcode Verification')
  const f2 = fn(c1.id, 2, 'Label Printing')
  const fArchived = fn(c1.id, 3, 'Retired', true)
  const r1 = run(f1.id, 1, 'Test Run 001')
  const s1 = step(r1.id, 1)
  const s2 = step(r1.id, 2)
  const s2a = step(r1.id, 1, s2.id)
  const s2b = step(r1.id, 2, s2.id, true)
  const s2c = step(r1.id, 3, s2.id)
  const s2c1 = step(r1.id, 1, s2c.id)
  return {
    chapters: [c2, cArchived, c1],
    functions: [f2, fArchived, f1],
    testRuns: [r1],
    steps: [s2c1, s2b, s2, s1, s2c, s2a],
  }
}

describe('buildProtocolTree', () => {
  it('orders siblings by position and numbers the outline', () => {
    const tree = buildProtocolTree(fixture())
    expect(tree.map((c) => [c.number, c.row.title])).toEqual([
      ['1', 'SMT Line 1'],
      ['2', 'Packaging'],
    ])
    expect(tree[0]!.functions.map((f) => [f.number, f.row.title])).toEqual([
      ['1.1', 'Barcode Verification'],
      ['1.2', 'Label Printing'],
    ])
    expect(tree[0]!.functions[0]!.testRuns[0]!.number).toBe('1.1.1')
  })

  it('nests sub-steps to any depth with their own numbering', () => {
    const steps = buildProtocolTree(fixture())[0]!.functions[0]!.testRuns[0]!.steps
    expect(flattenSteps(steps).map((s) => s.number)).toEqual(['1', '2', '2.1', '2.2', '2.2.1'])
  })

  it('leaves archived nodes out by default', () => {
    const tree = buildProtocolTree(fixture())
    expect(tree.map((c) => c.row.title)).not.toContain('Old line')
    expect(tree[0]!.functions.map((f) => f.row.title)).not.toContain('Retired')
  })

  it('shows archived nodes on request without giving them (or their children) a number', () => {
    const tree = buildProtocolTree(fixture(), { includeArchived: true })
    expect(tree.map((c) => [c.number, c.row.title])).toEqual([
      ['1', 'SMT Line 1'],
      ['2', 'Packaging'],
      [null, 'Old line'],
    ])
    const steps = flattenSteps(tree[0]!.functions[0]!.testRuns[0]!.steps)
    expect(steps.map((s) => s.number)).toEqual(['1', '2', '2.1', null, '2.2', '2.2.1'])
  })

  it('copes with an empty protocol', () => {
    expect(buildProtocolTree({ chapters: [], functions: [], testRuns: [], steps: [] })).toEqual([])
  })
})

describe('moveItem', () => {
  it('moves up and down', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('ignores moves past either end', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })
})

describe('effectiveStatus', () => {
  function withStatuses(statuses: Record<string, TestStepRow['status']>) {
    const rows = fixture()
    // s1, s2 (parent of s2a, archived s2b, s2c which is parent of s2c1)
    const [s2c1, s2b, s2, s1, s2c, s2a] = rows.steps
    const named = { s1: s1!, s2: s2!, s2a: s2a!, s2b: s2b!, s2c: s2c!, s2c1: s2c1! }
    for (const [name, status] of Object.entries(statuses)) named[name as keyof typeof named].status = status
    const tree = buildProtocolTree(rows)
    const chapter = tree[0]!
    const fn = chapter.functions[0]!
    const run = fn.testRuns[0]!
    const step = (n: string) => flattenSteps(run.steps).find((s) => s.row.id === named[n as keyof typeof named].id)!
    return { chapter, fn, run, step }
  }

  it('derives a parent step from its live sub-steps, ignoring archived ones and its own recorded value', () => {
    const t = withStatuses({ s2: 'failed', s2a: 'passed', s2b: 'failed', s2c1: 'passed' })
    expect(effectiveStatus(t.step('s2c'))).toBe('passed')
    expect(effectiveStatus(t.step('s2'))).toBe('passed')
  })

  it('rolls up to test run, function and chapter as the sub-steps finish', () => {
    const before = withStatuses({ s1: 'passed', s2a: 'passed', s2c1: 'not_started' })
    expect(effectiveStatus(before.run)).toBe('in_progress')
    expect(effectiveStatus(before.chapter)).toBe('in_progress')

    const after = withStatuses({ s1: 'passed', s2a: 'passed', s2c1: 'passed' })
    expect(effectiveStatus(after.step('s2'))).toBe('passed')
    expect(effectiveStatus(after.run)).toBe('passed')
    // The chapter's second function has no test runs yet, so the chapter is not done.
    expect(effectiveStatus(after.fn)).toBe('passed')
    expect(effectiveStatus(after.chapter)).toBe('in_progress')
  })

  it('lists the leaf steps whose status is recorded directly', () => {
    const t = withStatuses({})
    expect(leafSteps(t.run.steps).map((s) => s.number)).toEqual(['1', '2.1', '2.2.1'])
  })
})

describe('deriveRunStatus', () => {
  it.each([
    [[], 'not_started'],
    [['not_started', 'not_started'], 'not_started'],
    [['passed', 'not_started'], 'in_progress'],
    [['in_progress'], 'in_progress'],
    [['passed', 'passed'], 'passed'],
    [['passed', 'not_applicable'], 'passed'],
    [['not_applicable', 'not_applicable'], 'not_applicable'],
    [['passed', 'blocked', 'not_started'], 'blocked'],
    [['blocked', 'failed', 'passed'], 'failed'],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(deriveRunStatus(statuses)).toBe(expected)
  })
})
