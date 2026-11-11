import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { useAuth } from '@/auth/useAuth'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { displayNameSchema, passwordSchema, usernameSchema } from '@/lib/accounts'
import { functionErrorMessage, toUserMessage } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase'

const setupSchema = z
  .object({
    token: z.string().trim().min(1, 'Enter the setup token.'),
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { message: 'The passwords do not match.', path: ['confirm'] })

type SetupInput = z.input<typeof setupSchema>
type SetupValues = z.output<typeof setupSchema>

/** First-time setup (ADR-002). Reachable only while no administrator exists. */
export function SetupPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const needsSetup = useQuery({
    queryKey: ['needs_setup'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('needs_setup')
      if (error) throw error
      return data as boolean
    },
  })

  const form = useForm<SetupInput, unknown, SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { token: '', username: '', displayName: '', password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: SetupValues) {
    setSubmitError(null)
    const { error } = await getSupabase().functions.invoke('bootstrap-admin', {
      body: { token: values.token, username: values.username, displayName: values.displayName, password: values.password },
    })
    if (error) {
      setSubmitError((await functionErrorMessage(error)).message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['needs_setup'] })
    try {
      await signIn(values.username, values.password)
      void navigate('/', { replace: true })
    } catch {
      void navigate('/login', { replace: true })
    }
  }

  if (needsSetup.isPending) {
    return (
      <AuthLayout title="First-time setup">
        <LoadingState rows={3} />
      </AuthLayout>
    )
  }
  if (needsSetup.isError) {
    return (
      <AuthLayout title="First-time setup">
        <ErrorState message={toUserMessage(needsSetup.error)} onRetry={() => void needsSetup.refetch()} />
      </AuthLayout>
    )
  }
  if (!needsSetup.data) return <Navigate to="/login" replace />

  return (
    <AuthLayout
      title="First-time setup"
      description="Create the first administrator. You need the setup token from whoever deployed this application."
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField id="token" label="Setup token" error={errors.token?.message}>
          <Input type="password" autoComplete="off" {...fieldAria('token', errors.token?.message)} {...form.register('token')} />
        </FormField>
        <FormField
          id="username"
          label="Username"
          error={errors.username?.message}
          hint="3–32 characters: lowercase letters, digits, dot, underscore or hyphen."
        >
          <Input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            {...fieldAria('username', errors.username?.message, 'hint')}
            {...form.register('username')}
          />
        </FormField>
        <FormField id="displayName" label="Display name" error={errors.displayName?.message}>
          <Input autoComplete="name" {...fieldAria('displayName', errors.displayName?.message)} {...form.register('displayName')} />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="At least 10 characters, with letters and digits."
        >
          <Input
            type="password"
            autoComplete="new-password"
            {...fieldAria('password', errors.password?.message, 'hint')}
            {...form.register('password')}
          />
        </FormField>
        <FormField id="confirm" label="Confirm password" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...fieldAria('confirm', errors.confirm?.message)} {...form.register('confirm')} />
        </FormField>
        {submitError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {submitError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating administrator…' : 'Create administrator'}
        </Button>
      </form>
    </AuthLayout>
  )
}
