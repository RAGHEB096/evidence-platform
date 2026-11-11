import { FolderKanbanIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function ProtocolsPage() {
  return (
    <>
      <PageHeader title="Protocols" description="Test protocols you can access, with their structure and execution status." />
      <EmptyState icon={FolderKanbanIcon} title="No protocols yet" description="Protocols assigned to you will be listed here. Users allowed to create protocols can add one." />
    </>
  )
}
