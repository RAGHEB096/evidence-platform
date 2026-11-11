import type { Session } from '@supabase/supabase-js'
import { createContext } from 'react'
import type { Profile } from '@/auth/profile'

/** The only message a failed sign-in ever shows (ADR-001, SPEC 5). */
export const LOGIN_FAILED_MESSAGE = 'Incorrect username or password, or the account is not active.'

export class LoginError extends Error {
  constructor() {
    super(LOGIN_FAILED_MESSAGE)
  }
}

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  /** Null while loading, or when the account has no usable profile. */
  profile: Profile | null
  profileError: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<Profile | null>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
