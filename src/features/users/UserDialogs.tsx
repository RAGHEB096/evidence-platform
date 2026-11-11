import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAdminUsersAction, type AdminUserRow } from '@/features/users/api'
import { generateInitialPassword } from '@/features/users/password'
import { displayNameSchema, passwordSchema, usernameSchema } from '@/lib/accounts'
import { ActionError } from '@/lib/functions'

function errorText(error: unknown): string {
  return error instanceof ActionError ? error.message : 'The change could not be saved. Try again.'
}

function FlagCheckbox({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function PasswordField({ id, label, error, register, onGenerate }: { id: string; label: string; error?: string; register: object; onGenerate: () => void }) {
  return (
    <FormField id={id} label={label} error={error} hint="At least 10 characters, with letters and digits. The user must change it at first sign-in.">
      <div className="flex gap-2">
        <Input type="text" autoComplete="off" spellCheck={false} className="font-mono" {...fieldAria(id, error, 'hint')} {...register} />
        <Button type="button" variant="outline" onClick={onGenerate}>
          Generate
        </Button>
      </div>
    </FormField>
  )
}

const createSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  isAdmin: z.boolean(),
  canCreateProtocols: z.boolean(),
})

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const action = useAdminUsersAction()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<z.input<typeof createSchema>, unknown, z.output<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: '', displayName: '', password: generateInitialPassword(), isAdmin: false, canCreateProtocols: false },
  })
  const { errors, isSubmitting } = form.formState

  function close(next: boolean) {
    if (!next) {
      form.reset({ username: '', displayName: '', password: generateInitialPassword(), isAdmin: false, canCreateProtocols: false })
      setSubmitError(null)
    }
    onOpenChange(next)
  }

  async function onSubmit(values: z.output<typeof createSchema>) {
    setSubmitError(null)
    try {
      await action.mutateAsync({ action: 'create', ...values })
      toast.success(`User ${values.username} created`, {
        description: 'Give them their username and initial password. They choose their own password at first sign-in.',
      })
      close(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>The account signs in with a username and password. No email address is needed.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FormField id="new-username" label="Username" error={errors.username?.message} hint="3–32 characters: lowercase letters, digits, dot, underscore or hyphen.">
            <Input autoComplete="off" autoCapitalize="none" spellCheck={false} {...fieldAria('new-username', errors.username?.message, 'hint')} {...form.register('username')} />
          </FormField>
          <FormField id="new-display-name" label="Display name" error={errors.displayName?.message}>
            <Input autoComplete="off" {...fieldAria('new-display-name', errors.displayName?.message)} {...form.register('displayName')} />
          </FormField>
          <PasswordField
            id="new-password"
            label="Initial password"
            error={errors.password?.message}
            register={form.register('password')}
            onGenerate={() => form.setValue('password', generateInitialPassword(), { shouldValidate: true })}
          />
          <Controller
            control={form.control}
            name="canCreateProtocols"
            render={({ field }) => (
              <FlagCheckbox id="new-can-create" label="Can create protocols" description="May create new protocols and becomes their manager." checked={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="isAdmin"
            render={({ field }) => (
              <FlagCheckbox id="new-is-admin" label="Administrator" description="Sees every protocol, manages users and access, and sees the full audit trail." checked={field.value} onChange={field.onChange} />
            )}
          />
          {submitError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const editSchema = z.object({ displayName: displayNameSchema, isAdmin: z.boolean(), canCreateProtocols: z.boolean() })

export function EditUserDialog({ user, open, onOpenChange }: { user: AdminUserRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const action = useAdminUsersAction()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: { displayName: user.display_name, isAdmin: user.is_admin, canCreateProtocols: user.can_create_protocols },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: z.output<typeof editSchema>) {
    setSubmitError(null)
    try {
      if (values.displayName !== user.display_name) {
        await action.mutateAsync({ action: 'set_display_name', userId: user.id, displayName: values.displayName })
      }
      if (values.isAdmin !== user.is_admin || values.canCreateProtocols !== user.can_create_protocols) {
        await action.mutateAsync({ action: 'set_flags', userId: user.id, isAdmin: values.isAdmin, canCreateProtocols: values.canCreateProtocols })
      }
      toast.success('User updated')
      onOpenChange(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {user.username}</DialogTitle>
          <DialogDescription>The username cannot be changed, because it identifies the account in the audit trail.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FormField id="edit-display-name" label="Display name" error={errors.displayName?.message}>
            <Input autoComplete="off" {...fieldAria('edit-display-name', errors.displayName?.message)} {...form.register('displayName')} />
          </FormField>
          <Controller
            control={form.control}
            name="canCreateProtocols"
            render={({ field }) => (
              <FlagCheckbox id="edit-can-create" label="Can create protocols" description="May create new protocols and becomes their manager." checked={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="isAdmin"
            render={({ field }) => (
              <FlagCheckbox id="edit-is-admin" label="Administrator" description="Sees every protocol, manages users and access, and sees the full audit trail." checked={field.value} onChange={field.onChange} />
            )}
          />
          {submitError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const resetSchema = z.object({ password: passwordSchema })

export function ResetPasswordDialog({ user, open, onOpenChange }: { user: AdminUserRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const action = useAdminUsersAction()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: generateInitialPassword() },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: z.infer<typeof resetSchema>) {
    setSubmitError(null)
    try {
      await action.mutateAsync({ action: 'reset_password', userId: user.id, password: values.password })
      toast.success(`Password reset for ${user.username}`, { description: 'They must choose a new password at next sign-in.' })
      form.reset({ password: generateInitialPassword() })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reset password for {user.username}</DialogTitle>
          <DialogDescription>
            Their current password stops working at once. Until they choose a new one, they can sign in only to change it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <PasswordField
            id="reset-password"
            label="Temporary password"
            error={errors.password?.message}
            register={form.register('password')}
            onGenerate={() => form.setValue('password', generateInitialPassword(), { shouldValidate: true })}
          />
          {submitError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
