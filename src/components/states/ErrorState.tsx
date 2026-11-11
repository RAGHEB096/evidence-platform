import { AlertTriangleIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Shows a user-facing message only. Callers pass text meant for users,
 * never raw SQL errors, stack traces or internal ids (SPEC 5).
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50/60 px-6 py-10 text-center"
    >
      <AlertTriangleIcon aria-hidden="true" className="size-8 text-red-600" />
      <div className="space-y-1">
        <p className="font-medium text-red-900">{title}</p>
        <p className="max-w-prose text-sm text-red-800">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCwIcon aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
