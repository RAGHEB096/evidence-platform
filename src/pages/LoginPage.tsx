import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { LOGIN_FAILED_MESSAGE } from '@/auth/context'
import { useAuth } from '@/auth/useAuth'
import { FormField } from '@/components/FormField'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getSupabase } from '@/lib/supabase'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const setup = useQuery({
    queryKey: ['needs_setup'],
    queryFn: async () => {
      const { data, error: rpcError } = await getSupabase().rpc('needs_setup')
      if (rpcError) throw rpcError
      return data as boolean
    },
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await signIn(username, password)
      const from = (location.state as { from?: string } | null)?.from
      void navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch {
      setError(LOGIN_FAILED_MESSAGE)
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout title="Sign in" description="Use the username and password your administrator gave you.">
      {setup.data ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          No administrator exists yet.{' '}
          <Link to="/setup" className="font-medium underline underline-offset-2">
            Run first-time setup
          </Link>
          .
        </div>
      ) : null}
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormField id="username" label="Username">
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </FormField>
        <FormField id="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </FormField>
        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending || !username || !password}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
