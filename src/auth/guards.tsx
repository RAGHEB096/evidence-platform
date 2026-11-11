import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'

function FullPageLoading() {
  return (
    <div className="mx-auto max-w-md p-10">
      <LoadingState label="Checking your session…" rows={3} />
    </div>
  )
}

/**
 * Keeps the app behind sign-in. A UX convenience only: RLS refuses data to
 * anyone without an active profile, whatever the UI shows.
 */
export function RequireAuth() {
  const { status, profile, profileError, signOut, refreshProfile } = useAuth()
  const location = useLocation()
  const unusable = status === 'signed_in' && !profileError && (!profile || !profile.is_active)

  useEffect(() => {
    if (unusable) void signOut()
  }, [unusable, signOut])

  if (status === 'loading' || unusable) return <FullPageLoading />
  if (status === 'signed_out') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (profileError) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorState message="Your account details could not be loaded." onRetry={() => void refreshProfile()} />
      </div>
    )
  }
  if (profile?.must_change_password) return <Navigate to="/change-password" replace />
  return <Outlet />
}

/** Signed-in users who must choose a new password, and nobody else. */
export function RequirePasswordChange() {
  const { status, profile } = useAuth()
  if (status === 'loading') return <FullPageLoading />
  if (status === 'signed_out') return <Navigate to="/login" replace />
  if (!profile?.must_change_password) return <Navigate to="/" replace />
  return <Outlet />
}

/** Pages for signed-out visitors (sign-in, first-time setup). */
export function RedirectIfSignedIn() {
  const { status, profile } = useAuth()
  if (status === 'loading') return <FullPageLoading />
  if (status === 'signed_in' && profile?.is_active) return <Navigate to="/" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { profile } = useAuth()
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <Outlet />
}
