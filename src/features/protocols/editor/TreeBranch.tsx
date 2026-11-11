import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEditor } from '@/features/protocols/editor/editor-context'
import { nodeLabel } from '@/features/protocols/editor/node-label'
import { DragHandle, SortableItem, SortableList } from '@/features/protocols/editor/SortableList'
import { StatusBadge } from '@/components/StatusBadge'
import { STEP_STATUSES } from '@/domain/status'
import { CHILD_TYPE, childrenOf, effectiveStatus, moveItem, NODE_LABELS, type NodeType, type TreeNode } from '@/features/protocols/tree'
import { cn } from '@/lib/utils'

const ROW_STYLE: Record<NodeType, string> = {
  chapter: 'bg-muted/60 font-semibold',
  function: 'font-medium',
  test_run: '',
  test_step: 'text-sm',
}

function NodeTitle({ node }: { node: TreeNode }): ReactNode {
  switch (node.type) {
    case 'chapter':
    case 'function':
      return node.row.title
    case 'test_run':
      return (
        <>
          {node.row.reference ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">{node.row.reference}</span> : null}
          {node.row.title}
        </>
      )
    case 'test_step':
      return node.row.description || <span className="text-muted-foreground italic">No instruction</span>
  }
}

/**
 * One sibling list: live nodes are sortable (drag, or the move buttons);
 * archived nodes (shown to administrators on request) follow, unsortable.
 */
export function TreeBranch({ nodes, type, parentId, depth }: { nodes: TreeNode[]; type: NodeType; parentId: string; depth: number }) {
  const { canEdit, reorder } = useEditor()
  const live = nodes.filter((node) => !node.row.deleted_at)
  const archived = nodes.filter((node) => node.row.deleted_at)
  const liveIds = live.map((node) => node.row.id)
  const sortable = canEdit && live.length > 1

  return (
    <>
      <SortableList
        ids={liveIds}
        labels={new Map(live.map((node) => [node.row.id, nodeLabel(node)]))}
        enabled={sortable}
        onReorder={(ids) => reorder(type, parentId, ids)}
      >
        {live.map((node, index) => (
          <SortableItem key={node.row.id} id={node.row.id} enabled={sortable}>
            <TreeNodeRow
              node={node}
              depth={depth}
              canMoveUp={canEdit && index > 0}
              canMoveDown={canEdit && index < live.length - 1}
              onMove={(delta) => reorder(type, parentId, moveItem(liveIds, index, index + delta))}
            />
          </SortableItem>
        ))}
      </SortableList>
      {archived.length ? (
        <ul className="mt-1 space-y-1">
          {archived.map((node) => (
            <li key={node.row.id}>
              <TreeNodeRow node={node} depth={depth} canMoveUp={false} canMoveDown={false} onMove={() => {}} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function TreeNodeRow({
  node,
  depth,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  node: TreeNode
  depth: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: number) => void
}) {
  const editor = useEditor()
  const children = childrenOf(node)
  const isArchived = !!node.row.deleted_at
  const isOpen = !editor.collapsed.has(node.row.id)
  const label = nodeLabel(node)
  const childType = CHILD_TYPE[node.type]
  const childLabel = node.type === 'test_step' ? 'sub-step' : NODE_LABELS[childType].toLowerCase()
  const childrenId = `children-${node.row.id}`
  const editable = editor.canEdit && !isArchived

  return (
    <div>
      <div
        role="group"
        aria-label={label}
        data-node-type={node.type}
        className={cn(
          'group flex min-h-10 items-center gap-1 rounded-md border px-1.5 py-1',
          ROW_STYLE[node.type],
          isArchived && 'border-dashed bg-transparent text-muted-foreground',
        )}
        style={{ marginLeft: depth * 20 }}
      >
        <DragHandle label={label} />
        {children.length ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-expanded={isOpen}
            aria-controls={childrenId}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => editor.toggle(node.row.id)}
          >
            {isOpen ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          </Button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden="true" />
        )}
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {node.type === 'test_step' ? `Step ${node.number ?? '–'}` : (node.number ?? '–')}
        </span>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate">
            <NodeTitle node={node} />
          </div>
          {node.type === 'test_step' && node.row.expected_result ? (
            <div className="truncate text-xs text-muted-foreground">Expected: {node.row.expected_result}</div>
          ) : null}
        </div>
        {isArchived ? <Badge variant="outline">Archived</Badge> : <StatusBadge status={STEP_STATUSES[effectiveStatus(node)]} size="sm" className="shrink-0" />}

        {canMoveUp || canMoveDown ? (
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${label} up`} disabled={!canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUpIcon aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${label} down`} disabled={!canMoveDown} onClick={() => onMove(1)}>
              <ArrowDownIcon aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {node.type === 'test_run' && !isArchived ? (
          <Button asChild variant="outline" size="sm" className="h-7 shrink-0">
            <Link to={`/protocols/${node.row.protocol_id}/runs/${node.row.id}`} aria-label={`Open ${label} for execution`}>
              <PlayIcon aria-hidden="true" />
              <span className="hidden sm:inline">Execute</span>
            </Link>
          </Button>
        ) : null}

        {editable ? (
          <Button variant="ghost" size="sm" className="h-7 shrink-0" aria-label={`Add ${childLabel} to ${label}`} onClick={() => editor.openCreate(childType, node)}>
            <PlusIcon aria-hidden="true" />
            <span className="hidden lg:inline">{childLabel[0]!.toUpperCase() + childLabel.slice(1)}</span>
          </Button>
        ) : null}

        {editable || (isArchived && editor.isAdmin) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Actions for ${label}`}>
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editable ? (
                <>
                  <DropdownMenuItem onSelect={() => editor.openEdit(node)}>
                    <PencilIcon aria-hidden="true" />
                    Edit
                  </DropdownMenuItem>
                  {node.type !== 'test_step' ? (
                    <DropdownMenuItem onSelect={() => editor.duplicate(node)}>
                      <CopyIcon aria-hidden="true" />
                      Duplicate
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => editor.askArchive(node)}>
                    <ArchiveIcon aria-hidden="true" />
                    Archive…
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => editor.restore(node)}>
                  <RotateCcwIcon aria-hidden="true" />
                  Restore
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {children.length && isOpen ? (
        <div id={childrenId} className="mt-1">
          <TreeBranch nodes={children} type={childType} parentId={node.row.id} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  )
}
