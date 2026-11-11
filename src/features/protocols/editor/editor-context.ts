import { createContext, useContext } from 'react'
import type { NodeType, TreeNode } from '@/features/protocols/tree'

export interface EditorContextValue {
  canEdit: boolean
  isAdmin: boolean
  collapsed: ReadonlySet<string>
  toggle: (id: string) => void
  openCreate: (type: NodeType, parent: TreeNode | null) => void
  openEdit: (node: TreeNode) => void
  reorder: (type: NodeType, parentId: string, orderedIds: string[]) => void
  duplicate: (node: TreeNode) => void
  restore: (node: TreeNode) => void
  askArchive: (node: TreeNode) => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (!value) throw new Error('useEditor must be used inside the protocol tree editor')
  return value
}
