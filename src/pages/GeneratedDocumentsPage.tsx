import { FileTextIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function GeneratedDocumentsPage() {
  return (
    <>
      <PageHeader title="Generated Documents" description="History of Word reports generated from your protocols." />
      <EmptyState icon={FileTextIcon} title="No documents generated yet" description="Reports generated from the report builder will be listed here." />
    </>
  )
}
