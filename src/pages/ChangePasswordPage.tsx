import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import type { z } from 'zod'
import { useAuth } from '@/auth/useAuth'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { newPasswordFormSchema } from '@/lib/accounts'
import { toUserMessage } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase'

type Values = z.infer<typeof newPasswordFormSchema>

/**
 * Shown after an administrator set this user's password. Access stays closed
 * (in RLS, not just here) until complete_password_change() confirms the
 * password really changed (ADR-012).
 */
export function ChangePasswordPage() {
  const { refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(newPasswordFormSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: Values) {
    setSubmitError(null)
    const supabase = getSupabase()
    const { error: updateError } = await supabase.auth.updateUser({ password: values.password })
    if (updateError) {
      setSubmitError(
        updateError.code === 'same_password'
          ? 'Choose a password different from the one your administrator set.'
          : updateError.code === 'weak_password'
            ? 'That password is too weak. Use at least 10 characters with letters and digits.'
            : 'The password could not be changed. Try again.',
      )
      return
    }
    const { data: changed, error: rpcError } = await supabase.rpc('complete_password_change')
    if (rpcError || !changed) {
      setSubmitError(rpcError ? toUserMessage(rpcError) : 'Choose a password different from the one your administrator set.')
      return
    }
    await refreshProfile()
    void navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password" description="Your administrator set your current password. Choose your own before continuing.">
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField id="password" label="New password" error={errors.password?.message} hint="At least 10 characters, with letters and digits.">
          <Input type="password" autoComplete="new-password" {...fieldAria('password', errors.password?.message, 'hint')} {...form.register('password')} />
        </FormField>
        <FormField id="confirm" label="Confirm new password" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...fieldAria('confirm', errors.confirm?.message)} {...form.register('confirm')} />
        </FormField>
        {submitError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {submitError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save password'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
