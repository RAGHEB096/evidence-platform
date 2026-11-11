import { ArchiveIcon, ArrowLeftIcon, LockIcon, RotateCcwIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE_LABELS, roleAtLeast } from '@/domain/roles'
import { ARCHIVED_STATUS, PROTOCOL_STATUSES } from '@/domain/status'
import { ArchiveNodeDialog, type ArchiveTarget } from '@/features/protocols/editor/ArchiveNodeDialog'
import { ProtocolTreeEditor } from '@/features/protocols/editor/ProtocolTreeEditor'
import { ProtocolDetailsForm } from '@/features/protocols/ProtocolDetailsForm'
import { useMyProtocolRole, useProtocol, useProtocolRows, useProtocolTeam, useStructureMutations } from '@/features/protocols/structure-api'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'

export function ProtocolDetailPage() {
  const { protocolId = '' } = useParams()
  const { profile } = useAuth()
  const protocol = useProtocol(protocolId)
  const rows = useProtocolRows(protocolId)
  const role = useMyProtocolRole(protocolId)
  const directory = useUserDirectory()
  const isAdmin = !!profile?.is_admin
  const canManage = roleAtLeast(role.data, 'manager', isAdmin)
  const team = useProtocolTeam(protocolId, canManage)
  const { archive, restore } = useStructureMutations(protocolId)
  const [archiving, setArchiving] = useState<ArchiveTarget | null>(null)

  if (protocol.isPending || role.isPending) return <LoadingState label="Loading protocol…" />
  if (protocol.isError) return <ErrorState message={toUserMessage(protocol.error)} onRetry={() => void protocol.refetch()} />
  if (!protocol.data) {
    // RLS returns nothing for protocols the user is not assigned to; say so without revealing whether it exists.
    return (
      <EmptyState
        icon={LockIcon}
        title="Protocol not available"
        description="This protocol does not exist, or you are not assigned to it. Ask an administrator if you need access."
        action={
          <Button asChild variant="outline">
            <Link to="/protocols">Back to protocols</Link>
          </Button>
        }
      />
    )
  }

  const p = protocol.data
  const isArchived = !!p.deleted_at
  const name = (id: string) => directory.data?.get(id)?.display_name ?? 'Unknown user'

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/protocols">
          <ArrowLeftIcon aria-hidden="true" />
          All protocols
        </Link>
      </Button>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.reference}</span>
            <span>Version {p.version}</span>
            <StatusBadge status={isArchived ? ARCHIVED_STATUS : PROTOCOL_STATUSES[p.status]} />
            <span>
              Your role: {isAdmin ? 'Administrator' : role.data ? ROLE_LABELS[role.data] : '—'}
            </span>
          </span>
        }
        actions={
          isAdmin ? (
            isArchived ? (
              <Button
                variant="outline"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(
                    { type: 'protocol', id: p.id },
                    { onSuccess: () => toast.success('Protocol restored'), onError: (error) => toast.error(toUserMessage(error)) },
                  )
                }
              >
                <RotateCcwIcon aria-hidden="true" />
                Restore protocol
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchiving({ type: 'protocol', id: p.id, label: `protocol ${p.reference}` })}>
                <ArchiveIcon aria-hidden="true" />
                Archive protocol
              </Button>
            )
          ) : null
        }
      />
      {isArchived ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This protocol is archived. Only administrators can see it. Restore it to make it available to its team again.
        </p>
      ) : null}

      <Tabs defaultValue="structure">
        <TabsList>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          {canManage ? <TabsTrigger value="team">Team</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="structure" className="pt-4">
          {rows.isPending ? (
            <LoadingState label="Loading structure…" />
          ) : rows.isError ? (
            <ErrorState message={toUserMessage(rows.error)} onRetry={() => void rows.refetch()} />
          ) : (
            <ProtocolTreeEditor protocolId={p.id} rows={rows.data} canEdit={canManage && !isArchived} isAdmin={isAdmin} />
          )}
        </TabsContent>
        <TabsContent value="details" className="pt-4">
          <ProtocolDetailsForm protocol={p} canEdit={canManage} createdByName={name(p.created_by)} />
        </TabsContent>
        {canManage ? (
          <TabsContent value="team" className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              People assigned to this protocol. {isAdmin ? 'Change access from User Management.' : 'Administrators manage access.'}
            </p>
            {team.isPending ? (
              <LoadingState rows={2} />
            ) : team.isError ? (
              <ErrorState message={toUserMessage(team.error)} onRetry={() => void team.refetch()} />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {team.data.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          {isAdmin ? (
                            <Link className="underline-offset-2 hover:underline" to={`/users/${member.user_id}`}>
                              {name(member.user_id)}
                            </Link>
                          ) : (
                            name(member.user_id)
                          )}
                          <span className="ml-2 text-xs text-muted-foreground">{directory.data?.get(member.user_id)?.username}</span>
                        </TableCell>
                        <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>

      <ArchiveNodeDialog
        target={archiving}
        pending={archive.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={(target) =>
          archive.mutate(
            { type: target.type, id: target.id },
            {
              onSuccess: () => {
                setArchiving(null)
                toast.success('Protocol archived')
              },
              onError: (error) => toast.error(toUserMessage(error)),
            },
          )
        }
      />
    </>
  )
}
