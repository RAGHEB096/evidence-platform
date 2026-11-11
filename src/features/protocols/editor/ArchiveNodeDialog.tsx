import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { describeCounts } from '@/features/protocols/editor/counts'
import { fetchNodeCounts } from '@/features/protocols/structure-api'
import type { NodeType } from '@/features/protocols/tree'

export interface ArchiveTarget {
  type: NodeType | 'protocol'
  id: string
  /** e.g. "chapter 1 SMT Line 1" */
  label: string
}

/** Names what will be archived, including how many items sit beneath it (SPEC 4.1). */
export function ArchiveNodeDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: ArchiveTarget | null
  pending: boolean
  onCancel: () => void
  onConfirm: (target: ArchiveTarget) => void
}) {
  const counts = useQuery({
    queryKey: ['node-counts', target?.type, target?.id],
    queryFn: () => fetchNodeCounts(target!.type, target!.id),
    enabled: target !== null,
    staleTime: 0,
  })
  const beneath = counts.data ? describeCounts(counts.data) : null

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={`Archive ${target?.label ?? ''}?`}
      description={
        <>
          {counts.isPending ? (
            <p>Counting what sits beneath it…</p>
          ) : counts.isError ? (
            <p>The items beneath it could not be counted. Everything beneath it will be archived too.</p>
          ) : beneath ? (
            <p>
              This also archives <strong>{beneath}</strong> beneath it.
            </p>
          ) : (
            <p>Nothing sits beneath it.</p>
          )}
          <p>Archived items disappear from normal views and from draft reports. Nothing is deleted, and an administrator can restore them.</p>
        </>
      }
      confirmLabel="Archive"
      destructive
      pending={pending || counts.isPending}
      onConfirm={() => target && onConfirm(target)}
    />
  )
}
