import { NODE_LABELS, type TreeNode } from '@/features/protocols/tree'

/** Text that names a node in dialogs, toasts and accessible labels, e.g. "chapter 1 SMT Line 1". */
export function nodeLabel(node: TreeNode): string {
  const number = node.number ?? ''
  const text = (() => {
    switch (node.type) {
      case 'chapter':
      case 'function':
        return `${NODE_LABELS[node.type].toLowerCase()} ${number} ${node.row.title}`
      case 'test_run':
        return `test run ${number} ${node.row.title}`
      case 'test_step':
        return `step ${number}`
    }
  })()
  return text.replace(/\s+/g, ' ').trim()
}
