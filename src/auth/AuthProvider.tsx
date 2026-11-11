import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, LoginError, type AuthContextValue, type AuthStatus } from '@/auth/context'
import { PROFILE_COLUMNS, type Profile } from '@/auth/profile'
import { normalizeUsername, toAuthEmail } from '@/lib/accounts'
import { envResult } from '@/lib/env'
import { getSupabase } from '@/lib/supabase'
import { USERNAME_PATTERN } from '@/config'

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase().from('user_profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [initialised, setInitialised] = useState(false)

  useEffect(() => {
    const supabase = getSupabase()
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setInitialised(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setInitialised(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut()
    queryClient.clear()
  }, [queryClient])

  const signIn = useCallback(
    async (username: string, password: string) => {
      if (!envResult.ok) throw new LoginError()
      const normalized = normalizeUsername(username)
      if (!USERNAME_PATTERN.test(normalized) || password.length === 0) throw new LoginError()

      const supabase = getSupabase()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: toAuthEmail(normalized, envResult.env.VITE_AUTH_EMAIL_DOMAIN),
        password,
      })
      if (error || !data.user) throw new LoginError()

      // An account without an active profile gets nothing from RLS anyway;
      // sign it out so the UI does not pretend otherwise.
      const profile = await fetchProfile(data.user.id).catch(() => null)
      if (!profile || !profile.is_active) {
        await supabase.auth.signOut()
        throw new LoginError()
      }
      queryClient.setQueryData(['profile', data.user.id], profile)
    },
    [queryClient],
  )

  const refreshProfile = useCallback(async () => {
    if (!userId) return null
    const result = await profileQuery.refetch()
    return result.data ?? null
  }, [profileQuery, userId])

  const status: AuthStatus = !initialised
    ? 'loading'
    : !session
      ? 'signed_out'
      : profileQuery.isPending
        ? 'loading'
        : 'signed_in'

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile: profileQuery.data ?? null,
      profileError: profileQuery.isError,
      signIn,
      signOut,
      refreshProfile,
    }),
    [status, session, profileQuery.data, profileQuery.isError, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
