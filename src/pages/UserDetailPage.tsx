import { ArrowLeftIcon, KeyRoundIcon, PencilIcon, PowerIcon, UserXIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { accountStatus } from '@/domain/roles'
import { AccessCard } from '@/features/users/AccessCard'
import { useAdminUsers, useAdminUsersAction } from '@/features/users/api'
import { EditUserDialog, ResetPasswordDialog } from '@/features/users/UserDialogs'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { ActionError } from '@/lib/functions'

export function UserDetailPage() {
  const { userId } = useParams()
  const { profile: me } = useAuth()
  const users = useAdminUsers()
  const action = useAdminUsersAction()
  const [dialog, setDialog] = useState<'edit' | 'reset' | 'toggle' | null>(null)

  if (users.isPending) return <LoadingState label="Loading user…" />
  if (users.isError) return <ErrorState message={toUserMessage(users.error)} onRetry={() => void users.refetch()} />

  const user = users.data.find((candidate) => candidate.id === userId)
  if (!user) {
    return (
      <EmptyState
        icon={UserXIcon}
        title="User not found"
        description="This account does not exist."
        action={
          <Button asChild variant="outline">
            <Link to="/users">Back to users</Link>
          </Button>
        }
      />
    )
  }

  const isSelf = me?.id === user.id

  async function toggleActive() {
    try {
      await action.mutateAsync({ action: 'set_active', userId: user!.id, active: !user!.is_active })
      toast.success(user!.is_active ? `${user!.username} deactivated` : `${user!.username} reactivated`)
      setDialog(null)
    } catch (error) {
      toast.error(error instanceof ActionError ? error.message : 'The change could not be saved. Try again.')
    }
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/users">
          <ArrowLeftIcon aria-hidden="true" />
          All users
        </Link>
      </Button>
      <PageHeader
        title={user.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{user.username}</span>
            <StatusBadge status={accountStatus(user)} />
            {user.is_admin ? <Badge>Administrator</Badge> : null}
            {user.can_create_protocols ? <Badge variant="secondary">Can create protocols</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon aria-hidden="true" />
              Edit
            </Button>
            <Button variant="outline" onClick={() => setDialog('reset')}>
              <KeyRoundIcon aria-hidden="true" />
              Reset password
            </Button>
            <Button variant={user.is_active ? 'destructive' : 'default'} onClick={() => setDialog('toggle')}>
              <PowerIcon aria-hidden="true" />
              {user.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        }
      />

      <p className="text-sm text-muted-foreground">Account created {formatDateTime(user.created_at)}.</p>

      <AccessCard user={user} />

      <EditUserDialog user={user} open={dialog === 'edit'} onOpenChange={(open) => setDialog(open ? 'edit' : null)} />
      <ResetPasswordDialog user={user} open={dialog === 'reset'} onOpenChange={(open) => setDialog(open ? 'reset' : null)} />
      <ConfirmDialog
        open={dialog === 'toggle'}
        onOpenChange={(open) => setDialog(open ? 'toggle' : null)}
        title={user.is_active ? `Deactivate ${user.username}?` : `Reactivate ${user.username}?`}
        description={
          user.is_active ? (
            <>
              <p>They are signed out of every session and cannot sign in again. Their protocol access is kept but has no effect while the account is inactive.</p>
              <p>Their results, uploads and audit history stay as they are.</p>
              {isSelf ? <p className="font-medium text-foreground">This is your own account.</p> : null}
            </>
          ) : (
            <p>They can sign in again with their current password and regain their protocol access.</p>
          )
        }
        confirmLabel={user.is_active ? 'Deactivate' : 'Reactivate'}
        destructive={user.is_active}
        pending={action.isPending}
        onConfirm={() => void toggleActive()}
      />
    </>
  )
}
