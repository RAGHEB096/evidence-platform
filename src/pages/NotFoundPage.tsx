import { CompassIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/states/EmptyState'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="The page you asked for does not exist or has moved."
      action={
        <Button asChild variant="outline">
          <Link to="/">Go to the dashboard</Link>
        </Button>
      }
    />
  )
}
