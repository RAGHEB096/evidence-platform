import { SettingsIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your account and, for administrators, application limits." />
      <EmptyState icon={SettingsIcon} title="Settings are not available yet" description="Display name, password and administrator limits will be managed here." />
    </>
  )
}
