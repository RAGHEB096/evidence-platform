import { LayoutDashboardIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Overview of protocols, execution progress and recent activity." />
      <EmptyState icon={LayoutDashboardIcon} title="Nothing to show yet" description="Totals and recent activity appear here once protocols exist." />
    </>
  )
}
