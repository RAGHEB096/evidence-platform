import type { NodeCounts } from '@/features/protocols/structure-api'

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** "3 functions, 5 test runs, 41 steps and 12 evidence files" — only the non-zero parts. */
export function describeCounts(counts: NodeCounts): string | null {
  const parts = [
    counts.functions ? plural(counts.functions, 'function', 'functions') : null,
    counts.test_runs ? plural(counts.test_runs, 'test run', 'test runs') : null,
    counts.test_steps ? plural(counts.test_steps, 'step', 'steps') : null,
    counts.evidence ? plural(counts.evidence, 'evidence file', 'evidence files') : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
