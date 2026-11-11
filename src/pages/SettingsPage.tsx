import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/auth/useAuth'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { displayNameSchema, newPasswordFormSchema, toAuthEmail } from '@/lib/accounts'
import { envResult } from '@/lib/env'
import { toUserMessage } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase'

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b pb-8 md:grid-cols-[16rem_1fr]">
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="max-w-md">{children}</div>
    </section>
  )
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </p>
  ) : null
}

function DisplayNameForm() {
  const { profile, refreshProfile } = useAuth()
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const form = useForm<{ displayName: string }>({
    resolver: zodResolver(z.object({ displayName: displayNameSchema })),
    values: { displayName: profile?.display_name ?? '' },
  })
  const { errors, isSubmitting, isDirty } = form.formState

  async function onSubmit({ displayName }: { displayName: string }) {
    setProblem(null)
    const { data, error } = await getSupabase().from('user_profiles').update({ display_name: displayName }).eq('id', profile!.id).select('id')
    if (error || !data?.length) return setProblem(toUserMessage(error ?? { code: '42501' }))
    await Promise.all([refreshProfile(), queryClient.invalidateQueries({ queryKey: ['user-directory'] })])
    toast.success('Display name saved')
  }

  return (
    <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormField id="settings-display-name" label="Display name" error={errors.displayName?.message} hint={`Your username, ${profile?.username}, cannot be changed.`}>
        <Input {...fieldAria('settings-display-name', errors.displayName?.message, 'hint')} {...form.register('displayName')} />
      </FormField>
      <Problem message={problem} />
      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? 'Saving…' : 'Save display name'}
      </Button>
    </form>
  )
}

const passwordFormSchema = z.intersection(z.object({ current: z.string().min(1, 'Enter your current password.') }), newPasswordFormSchema)
type PasswordValues = z.infer<typeof passwordFormSchema>

function PasswordForm() {
  const { profile } = useAuth()
  const [problem, setProblem] = useState<string | null>(null)
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordFormSchema), defaultValues: { current: '', password: '', confirm: '' } })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: PasswordValues) {
    setProblem(null)
    if (!envResult.ok || !profile) return
    const supabase = getSupabase()
    // Confirm it is really this user at the keyboard before changing the password.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(profile.username, envResult.env.VITE_AUTH_EMAIL_DOMAIN),
      password: values.current,
    })
    if (verifyError) return setProblem('Your current password is not correct.')
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      return setProblem(
        error.code === 'same_password'
          ? 'Choose a password different from your current one.'
          : error.code === 'weak_password'
            ? 'That password is too weak. Use at least 10 characters with letters and digits.'
            : 'The password could not be changed. Try again.',
      )
    }
    // Records the change in the audit trail.
    await supabase.rpc('complete_password_change')
    form.reset()
    toast.success('Password changed')
  }

  return (
    <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormField id="settings-current" label="Current password" error={errors.current?.message}>
        <Input type="password" autoComplete="current-password" {...fieldAria('settings-current', errors.current?.message)} {...form.register('current')} />
      </FormField>
      <FormField id="settings-new" label="New password" error={errors.password?.message} hint="At least 10 characters, with letters and digits.">
        <Input type="password" autoComplete="new-password" {...fieldAria('settings-new', errors.password?.message, 'hint')} {...form.register('password')} />
      </FormField>
      <FormField id="settings-confirm" label="Confirm new password" error={errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...fieldAria('settings-confirm', errors.confirm?.message)} {...form.register('confirm')} />
      </FormField>
      <Problem message={problem} />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  )
}

const MB = 1024 * 1024
const adminSchema = z.object({
  uploadLimitMb: z.coerce.number<string>().int('Use a whole number of megabytes.').min(1, 'At least 1 MB.').max(50, 'At most 50 MB, the Supabase Free plan’s per-file maximum.'),
  pageSize: z.enum(['A4', 'Letter']),
  longEdge: z.coerce.number<string>().int('Use a whole number of pixels.').min(500, 'At least 500 px.').max(6000, 'At most 6000 px.'),
})
type AdminInput = z.input<typeof adminSchema>
type AdminValues = z.output<typeof adminSchema>

function AdminSettingsForm() {
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const settings = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('app_settings').select('key, value')
      if (error) throw error
      return new Map((data as { key: string; value: unknown }[]).map((row) => [row.key, row.value]))
    },
  })
  const form = useForm<AdminInput, unknown, AdminValues>({
    resolver: zodResolver(adminSchema),
    values: settings.data
      ? {
          uploadLimitMb: String(Math.round(Number(settings.data.get('upload_limit_bytes')) / MB)),
          pageSize: (settings.data.get('report_page_size') as 'A4' | 'Letter') ?? 'A4',
          longEdge: String(settings.data.get('image_long_edge_px') ?? 2000),
        }
      : undefined,
  })
  const { errors, isSubmitting, isDirty } = form.formState

  if (settings.isPending) return <LoadingState rows={3} label="Loading settings…" />
  if (settings.isError) return <ErrorState message={toUserMessage(settings.error)} onRetry={() => void settings.refetch()} />

  async function onSubmit(values: AdminValues) {
    setProblem(null)
    const supabase = getSupabase()
    const updates: [string, unknown][] = [
      ['upload_limit_bytes', values.uploadLimitMb * MB],
      ['report_page_size', values.pageSize],
      ['image_long_edge_px', values.longEdge],
    ]
    for (const [key, value] of updates) {
      if (JSON.stringify(settings.data!.get(key)) === JSON.stringify(value)) continue
      const { data, error } = await supabase.from('app_settings').update({ value }).eq('key', key).select('key')
      if (error || !data?.length) return setProblem(toUserMessage(error ?? { code: '42501' }))
    }
    await queryClient.invalidateQueries({ queryKey: ['settings'] })
    toast.success('Application settings saved')
  }

  return (
    <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormField id="settings-upload" label="Upload size limit (MB)" error={errors.uploadLimitMb?.message} hint="Per evidence file. Also applied to the storage bucket.">
        <Input type="number" min={1} max={50} {...fieldAria('settings-upload', errors.uploadLimitMb?.message, 'hint')} {...form.register('uploadLimitMb')} />
      </FormField>
      <FormField id="settings-page-size" label="Report page size">
        <Controller
          control={form.control}
          name="pageSize"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="settings-page-size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A4">A4</SelectItem>
                <SelectItem value="Letter">Letter</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField id="settings-long-edge" label="Maximum embedded image size (px)" error={errors.longEdge?.message} hint="Longest edge of each image in generated reports. Originals are never changed.">
        <Input type="number" min={500} max={6000} {...fieldAria('settings-long-edge', errors.longEdge?.message, 'hint')} {...form.register('longEdge')} />
      </FormField>
      <Problem message={problem} />
      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? 'Saving…' : 'Save application settings'}
      </Button>
    </form>
  )
}

export function SettingsPage() {
  const { profile } = useAuth()
  return (
    <>
      <PageHeader title="Settings" description="Your account and, for administrators, application limits." />
      <div className="space-y-8">
        <Section title="Display name" description="Shown next to your work: results, uploads, reports and the audit trail.">
          <DisplayNameForm />
        </Section>
        <Section title="Password" description="Enter your current password to choose a new one. The change is recorded in the audit trail.">
          <PasswordForm />
        </Section>
        {profile?.is_admin ? (
          <Section title="Application settings" description="Apply to everyone. Each change is recorded in the audit trail.">
            <AdminSettingsForm />
          </Section>
        ) : null}
      </div>
    </>
  )
}
