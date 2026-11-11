import { UsersIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function UsersPage() {
  return (
    <>
      <PageHeader title="User Management" description="Create accounts, manage access and assign users to protocols." />
      <EmptyState icon={UsersIcon} title="No users to show" description="Accounts created by administrators will be listed here." />
    </>
  )
}
