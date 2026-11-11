import { FolderTreeIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/states/EmptyState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ArchiveNodeDialog, type ArchiveTarget } from '@/features/protocols/editor/ArchiveNodeDialog'
import { EditorContext, type EditorContextValue } from '@/features/protocols/editor/editor-context'
import { NodeDialog, type NodeDialogState } from '@/features/protocols/editor/NodeDialog'
import { nodeLabel } from '@/features/protocols/editor/node-label'
import { TreeBranch } from '@/features/protocols/editor/TreeBranch'
import { useStructureMutations } from '@/features/protocols/structure-api'
import { buildProtocolTree, childrenOf, NODE_LABELS, type NodeType, type ProtocolRows, type TreeNode } from '@/features/protocols/tree'
import { toUserMessage } from '@/lib/errors'

/**
 * The whole hierarchy as an expandable tree. Every change is written to the
 * database immediately; the tree is then refetched from it (SPEC 4.3).
 */
export function ProtocolTreeEditor({ protocolId, rows, canEdit, isAdmin }: { protocolId: string; rows: ProtocolRows; canEdit: boolean; isAdmin: boolean }) {
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [dialog, setDialog] = useState<NodeDialogState | null>(null)
  const [archiving, setArchiving] = useState<ArchiveTarget | null>(null)
  const mutations = useStructureMutations(protocolId)
  const tree = useMemo(() => buildProtocolTree(rows, { includeArchived: isAdmin && showArchived }), [rows, isAdmin, showArchived])

  const parentIds = useMemo(() => {
    const ids: string[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        const children = childrenOf(node)
        if (children.length) {
          ids.push(node.row.id)
          walk(children)
        }
      }
    }
    walk(tree)
    return ids
  }, [tree])

  async function run(promise: Promise<unknown>, success: string) {
    try {
      await promise
      toast.success(success)
    } catch (error) {
      toast.error(toUserMessage(error))
    }
  }

  const expand = (id: string) =>
    setCollapsed((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })

  const editor: EditorContextValue = {
    canEdit,
    isAdmin,
    collapsed,
    toggle: (id) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    openCreate: (type: NodeType, parent: TreeNode | null) => {
      const parentId = parent === null ? protocolId : parent.type === 'test_step' ? parent.row.test_run_id : parent.row.id
      setDialog({
        mode: 'create',
        type,
        context: parent ? `Under ${nodeLabel(parent)}.` : 'At the end of the protocol.',
        submit: async (fields) => {
          await mutations.create.mutateAsync({ type, parentId, parentStepId: parent?.type === 'test_step' ? parent.row.id : null, fields })
          if (parent) expand(parent.row.id)
          toast.success(`${NODE_LABELS[type]} added`)
        },
      })
    },
    openEdit: (node) => {
      const row = node.row as unknown as Record<string, string | undefined>
      setDialog({
        mode: 'edit',
        type: node.type,
        context: `Editing ${nodeLabel(node)}.`,
        initial: { title: row.title, description: row.description, reference: row.reference, expected_result: row.expected_result },
        submit: async (fields) => {
          await mutations.update.mutateAsync({ type: node.type, id: node.row.id, fields })
          toast.success('Saved')
        },
      })
    },
    reorder: (type, parentId, orderedIds) =>
      mutations.reorder.mutate({ type, parentId, orderedIds }, { onError: (error) => toast.error(toUserMessage(error)) }),
    duplicate: (node) => void run(mutations.duplicate.mutateAsync({ type: node.type, id: node.row.id }), `Duplicated ${nodeLabel(node)}`),
    restore: (node) => void run(mutations.restore.mutateAsync({ type: node.type, id: node.row.id }), `Restored ${nodeLabel(node)}`),
    askArchive: (node) => setArchiving({ type: node.type, id: node.row.id, label: nodeLabel(node) }),
  }

  return (
    <EditorContext.Provider value={editor}>
      <section aria-label="Protocol structure" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Button onClick={() => editor.openCreate('chapter', null)}>
              <PlusIcon aria-hidden="true" />
              Add chapter
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set(parentIds))}>
            Collapse all
          </Button>
          {isAdmin ? (
            <div className="ml-auto flex items-center gap-2">
              <Checkbox id="show-archived" checked={showArchived} onCheckedChange={(value) => setShowArchived(value === true)} />
              <Label htmlFor="show-archived">Show archived items</Label>
            </div>
          ) : null}
        </div>

        {tree.length === 0 ? (
          <EmptyState
            icon={FolderTreeIcon}
            title="No chapters yet"
            description={
              canEdit
                ? 'Start with “Add chapter”, for example one chapter per production station. Then add functions, test runs and steps beneath it.'
                : 'A manager of this protocol has not added any chapters yet.'
            }
          />
        ) : (
          <TreeBranch nodes={tree} type="chapter" parentId={protocolId} depth={0} />
        )}

        <NodeDialog state={dialog} onClose={() => setDialog(null)} />
        <ArchiveNodeDialog
          target={archiving}
          pending={mutations.archive.isPending}
          onCancel={() => setArchiving(null)}
          onConfirm={(target) =>
            void run(
              mutations.archive.mutateAsync({ type: target.type, id: target.id }).then(() => setArchiving(null)),
              `Archived ${target.label}`,
            )
          }
        />
      </section>
    </EditorContext.Provider>
  )
}
