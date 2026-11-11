import { PlusIcon, UsersIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FilterSelect, ListToolbar } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { accountStatus } from '@/domain/roles'
import { useAdminUsers } from '@/features/users/api'
import { CreateUserDialog } from '@/features/users/UserDialogs'
import { toUserMessage } from '@/lib/errors'
import { formatDate, matchesSearch } from '@/lib/format'

type StatusFilter = 'all' | 'active' | 'inactive' | 'password_change'
type PermissionFilter = 'all' | 'admin' | 'creator' | 'standard'

export function UsersPage() {
  const users = useAdminUsers()
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [permission, setPermission] = useState<PermissionFilter>('all')

  const filtered = useMemo(
    () =>
      (users.data ?? []).filter((user) => {
        if (!matchesSearch(search, user.username, user.display_name)) return false
        if (status === 'active' && !(user.is_active && !user.must_change_password)) return false
        if (status === 'inactive' && user.is_active) return false
        if (status === 'password_change' && !(user.is_active && user.must_change_password)) return false
        if (permission === 'admin' && !user.is_admin) return false
        if (permission === 'creator' && !user.can_create_protocols) return false
        if (permission === 'standard' && (user.is_admin || user.can_create_protocols)) return false
        return true
      }),
    [users.data, search, status, permission],
  )

  return (
    <>
      <PageHeader
        title="User Management"
        description="Create accounts, set what each person may do, and assign them to protocols."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create user
          </Button>
        }
      />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ListToolbar search={search} onSearch={setSearch} placeholder="Search by username or display name">
        <FilterSelect
          label="Account status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'password_change', label: 'Must change password' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <FilterSelect
          label="Permissions"
          value={permission}
          onChange={setPermission}
          options={[
            { value: 'all', label: 'All permissions' },
            { value: 'admin', label: 'Administrators' },
            { value: 'creator', label: 'Can create protocols' },
            { value: 'standard', label: 'Standard users' },
          ]}
        />
      </ListToolbar>

      {users.isPending ? (
        <LoadingState label="Loading users…" />
      ) : users.isError ? (
        <ErrorState message={toUserMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={users.data.length === 0 ? 'No users yet' : 'No users match'}
          description={users.data.length === 0 ? 'Create the first account with “Create user”.' : 'Change the search or filters to see more users.'}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium">{user.display_name}</div>
                    <div className="text-xs text-muted-foreground">{user.username}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.is_admin ? <Badge>Administrator</Badge> : null}
                      {user.can_create_protocols ? <Badge variant="secondary">Can create protocols</Badge> : null}
                      {!user.is_admin && !user.can_create_protocols ? <span className="text-sm text-muted-foreground">Standard</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={accountStatus(user)} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(user.created_at)}</TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/users/${user.id}`} aria-label={`Manage ${user.username}`}>
                        Manage
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
