import { ImagesIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function EvidenceLibraryPage() {
  return (
    <>
      <PageHeader title="Evidence Library" description="Screenshot evidence across every protocol you can access." />
      <EmptyState icon={ImagesIcon} title="No evidence yet" description="Evidence uploaded to test runs and steps will be listed here." />
    </>
  )
}
