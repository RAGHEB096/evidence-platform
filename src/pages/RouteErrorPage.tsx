import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { ErrorState } from '@/components/states/ErrorState'

/**
 * Catches render errors anywhere in the route tree. Details go to the console
 * for developers; the user sees a plain message and a way to recover.
 */
export function RouteErrorPage() {
  const error = useRouteError()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl p-6">
      <ErrorState
        message="This page could not be displayed. Reload to try again; if it keeps happening, tell your administrator."
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
