import { FolderKanbanIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROTOCOL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type ProtocolRole } from '@/domain/roles'
import { useProtocols } from '@/features/protocols/api'
import { useAccessMutations, useUserAccess, type AccessRow, type AdminUserRow } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

function RoleSelect({ id, value, onChange, disabled }: { id?: string; value: ProtocolRole; onChange: (role: ProtocolRole) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ProtocolRole)} disabled={disabled}>
      <SelectTrigger id={id} className="w-36" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROTOCOL_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A user's protocol assignments: add, change role, remove (administrators only, enforced by RLS). */
export function AccessCard({ user }: { user: AdminUserRow }) {
  const access = useUserAccess(user.id)
  const protocols = useProtocols()
  const { grant, change, remove } = useAccessMutations(user.id)
  const [addOpen, setAddOpen] = useState(false)
  const [newProtocol, setNewProtocol] = useState<string>('')
  const [newRole, setNewRole] = useState<ProtocolRole>('viewer')
  const [removing, setRemoving] = useState<AccessRow | null>(null)

  const available = useMemo(() => {
    const assigned = new Set((access.data ?? []).map((row) => row.protocol?.id))
    return (protocols.data ?? []).filter((protocol) => !protocol.deleted_at && !assigned.has(protocol.id))
  }, [access.data, protocols.data])

  async function onGrant() {
    try {
      await grant.mutateAsync({ protocolId: newProtocol, role: newRole })
      toast.success(`Access granted to ${user.username}`)
      setAddOpen(false)
      setNewProtocol('')
      setNewRole('viewer')
    } catch (error) {
      toast.error(toUserMessage(error))
    }
  }

  async function onChangeRole(row: AccessRow, role: ProtocolRole) {
    try {
      await change.mutateAsync({ accessId: row.id, role })
      toast.success(`${user.username} is now ${ROLE_LABELS[role].toLowerCase()} on ${row.protocol?.reference ?? 'the protocol'}`)
    } catch (error) {
      toast.error(toUserMessage(error))
    }
  }

  async function onRemove() {
    if (!removing) return
    try {
      await remove.mutateAsync(removing.id)
      toast.success('Access removed')
      setRemoving(null)
    } catch (error) {
      toast.error(toUserMessage(error))
    }
  }

  return (
    <section aria-labelledby="access-heading" className="space-y-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="access-heading" className="font-semibold">
            Protocol access
          </h2>
          <p className="text-sm text-muted-foreground">What this user can see and do on each protocol.</p>
        </div>
        <Button variant="outline" onClick={() => setAddOpen(true)} disabled={!user.is_active}>
          <PlusIcon aria-hidden="true" />
          Add access
        </Button>
      </div>

      {access.isPending ? (
        <LoadingState rows={2} />
      ) : access.isError ? (
        <ErrorState message={toUserMessage(access.error)} onRetry={() => void access.refetch()} />
      ) : access.data.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          title="No protocol access"
          description={user.is_admin ? 'Administrators see every protocol without being assigned.' : 'Use “Add access” to assign this user to a protocol with a role.'}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocol</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {access.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.protocol?.name ?? 'Unavailable protocol'}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.protocol?.reference}
                    {row.protocol?.deleted_at ? ' · archived' : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <RoleSelect value={row.role} onChange={(role) => void onChangeRole(row, role)} disabled={change.isPending} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(row.granted_at)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" aria-label={`Remove access to ${row.protocol?.reference ?? 'protocol'}`} onClick={() => setRemoving(row)}>
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add protocol access</DialogTitle>
            <DialogDescription>Assign {user.username} to a protocol with a role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="access-protocol">Protocol</Label>
              <Select value={newProtocol} onValueChange={setNewProtocol}>
                <SelectTrigger id="access-protocol" className="w-full">
                  <SelectValue placeholder={available.length ? 'Choose a protocol' : 'No other protocols available'} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((protocol) => (
                    <SelectItem key={protocol.id} value={protocol.id}>
                      {protocol.reference} — {protocol.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access-role">Role</Label>
              <RoleSelect id="access-role" value={newRole} onChange={setNewRole} />
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[newRole]}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onGrant()} disabled={!newProtocol || grant.isPending}>
              {grant.isPending ? 'Granting…' : 'Grant access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove access?"
        description={
          <p>
            {user.username} will no longer see <strong>{removing?.protocol?.reference}</strong> ({removing?.protocol?.name}). Their past
            results, uploads and audit history stay as they are.
          </p>
        }
        confirmLabel="Remove access"
        destructive
        pending={remove.isPending}
        onConfirm={() => void onRemove()}
      />
    </section>
  )
}
