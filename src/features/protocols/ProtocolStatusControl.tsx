import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ARCHIVED_STATUS, PROTOCOL_STATUS_HELP, PROTOCOL_STATUSES, type ProtocolStatus } from '@/domain/status'
import type { ProtocolRow } from '@/features/protocols/api'
import { useStructureMutations } from '@/features/protocols/structure-api'
import { toUserMessage } from '@/lib/errors'

const ORDER: ProtocolStatus[] = ['draft', 'released', 'completed']

/**
 * The protocol's lifecycle (ADR-017). Managers change it here; outside Draft
 * the database locks the structure and details. Everyone else sees the badge.
 */
export function ProtocolStatusControl({ protocol, canManage }: { protocol: ProtocolRow; canManage: boolean }) {
  const { updateProtocol } = useStructureMutations(protocol.id)
  const [target, setTarget] = useState<ProtocolStatus | null>(null)

  if (protocol.deleted_at) return <StatusBadge status={ARCHIVED_STATUS} />
  const current = PROTOCOL_STATUSES[protocol.status]
  if (!canManage) return <StatusBadge status={current} />

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-1" aria-label={`Protocol status: ${current.label}. Change status`}>
            <StatusBadge status={current} />
            <ChevronDownIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {ORDER.map((status) => (
            <DropdownMenuItem key={status} disabled={status === protocol.status} onSelect={() => setTarget(status)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{PROTOCOL_STATUSES[status].label}</span>
              <span className="text-xs text-muted-foreground">{PROTOCOL_STATUS_HELP[status]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target ? `Set ${protocol.reference} to ${PROTOCOL_STATUSES[target].label}?` : ''}
        description={
          target === 'draft' ? (
            <p>The structure and details become editable again. The change is recorded in the audit trail.</p>
          ) : (
            <>
              <p>{target ? PROTOCOL_STATUS_HELP[target] : ''}</p>
              <p>Chapters, functions, test runs, steps and the protocol details can no longer be added, edited, reordered, duplicated or archived until it is set back to Draft.</p>
            </>
          )
        }
        confirmLabel={target ? `Set to ${PROTOCOL_STATUSES[target].label}` : 'Confirm'}
        pending={updateProtocol.isPending}
        onConfirm={() =>
          target &&
          updateProtocol.mutate(
            { status: target },
            {
              onSuccess: () => {
                toast.success(`${protocol.reference} is now ${PROTOCOL_STATUSES[target].label}`)
                setTarget(null)
              },
              onError: (error) => toast.error(toUserMessage(error)),
            },
          )
        }
      />
    </>
  )
}
