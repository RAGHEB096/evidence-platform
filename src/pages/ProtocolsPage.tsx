import { FolderKanbanIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { FilterSelect, ListToolbar } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ARCHIVED_STATUS, PROTOCOL_STATUSES, type ProtocolStatus, type StatusDefinition } from '@/domain/status'
import { useProtocols, type ProtocolRow } from '@/features/protocols/api'
import { CreateProtocolDialog } from '@/features/protocols/CreateProtocolDialog'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime, matchesSearch } from '@/lib/format'

type StatusFilter = 'all' | ProtocolStatus | 'archived'

/** An archived protocol shows as Archived whatever its stored status (ADR-015). */
function displayStatus(protocol: ProtocolRow): StatusDefinition {
  return protocol.deleted_at ? ARCHIVED_STATUS : PROTOCOL_STATUSES[protocol.status]
}

export function ProtocolsPage() {
  const { profile } = useAuth()
  const protocols = useProtocols()
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const canCreate = !!profile && (profile.is_admin || profile.can_create_protocols)

  const filtered = useMemo(
    () =>
      (protocols.data ?? []).filter((protocol) => {
        if (!matchesSearch(search, protocol.name, protocol.reference, protocol.description)) return false
        if (status === 'all') return !protocol.deleted_at
        if (status === 'archived') return !!protocol.deleted_at
        return !protocol.deleted_at && protocol.status === status
      }),
    [protocols.data, search, status],
  )

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'draft', label: 'Draft' },
    { value: 'released', label: 'Released' },
    { value: 'completed', label: 'Completed' },
    ...(profile?.is_admin ? [{ value: 'archived' as const, label: 'Archived' }] : []),
  ]

  return (
    <>
      <PageHeader
        title="Protocols"
        description="Test protocols you can access, with their structure and execution status."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon aria-hidden="true" />
              Create protocol
            </Button>
          ) : null
        }
      />
      {canCreate ? <CreateProtocolDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}

      <ListToolbar search={search} onSearch={setSearch} placeholder="Search by name, reference or description">
        <FilterSelect label="Protocol status" value={status} onChange={setStatus} options={statusOptions} />
      </ListToolbar>

      {protocols.isPending ? (
        <LoadingState label="Loading protocols…" />
      ) : protocols.isError ? (
        <ErrorState message={toUserMessage(protocols.error)} onRetry={() => void protocols.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          title={protocols.data.length === 0 ? 'No protocols yet' : 'No protocols match'}
          description={
            protocols.data.length > 0
              ? 'Change the search or filter to see more protocols.'
              : canCreate
                ? 'Create the first protocol with “Create protocol”.'
                : 'You are not assigned to any protocol yet. Ask an administrator for access.'
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last modified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((protocol) => (
                <TableRow key={protocol.id}>
                  <TableCell className="font-mono text-sm">{protocol.reference}</TableCell>
                  <TableCell className="font-medium">
                    <Link to={`/protocols/${protocol.id}`} className="underline-offset-2 hover:underline">
                      {protocol.name}
                    </Link>
                  </TableCell>
                  <TableCell>{protocol.version}</TableCell>
                  <TableCell>
                    <StatusBadge status={displayStatus(protocol)} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(protocol.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
