import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCreateProtocol } from '@/features/protocols/api'
import { protocolDetailsSchema } from '@/features/protocols/schema'
import { toUserMessage } from '@/lib/errors'

type Values = z.infer<typeof protocolDetailsSchema>

export function CreateProtocolDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}) {
  const create = useCreateProtocol()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(protocolDetailsSchema),
    defaultValues: { reference: '', name: '', version: '1.0', description: '' },
  })
  const { errors, isSubmitting } = form.formState

  function close(next: boolean) {
    if (!next) {
      form.reset()
      setSubmitError(null)
    }
    onOpenChange(next)
  }

  async function onSubmit(values: Values) {
    setSubmitError(null)
    try {
      const id = await create.mutateAsync(values)
      toast.success(`Protocol ${values.reference} created`, { description: 'You are its manager.' })
      close(false)
      onCreated?.(id)
    } catch (error) {
      setSubmitError(toUserMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create protocol</DialogTitle>
          <DialogDescription>You become the manager of the new protocol and can then build its structure.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField id="protocol-reference" label="Reference" error={errors.reference?.message} hint="Unique, e.g. OQ-MES-001.">
              <Input autoComplete="off" {...fieldAria('protocol-reference', errors.reference?.message, 'hint')} {...form.register('reference')} />
            </FormField>
            <FormField id="protocol-version" label="Version" error={errors.version?.message}>
              <Input autoComplete="off" {...fieldAria('protocol-version', errors.version?.message)} {...form.register('version')} />
            </FormField>
          </div>
          <FormField id="protocol-name" label="Name" error={errors.name?.message}>
            <Input autoComplete="off" {...fieldAria('protocol-name', errors.name?.message)} {...form.register('name')} />
          </FormField>
          <FormField id="protocol-description" label="Description" error={errors.description?.message}>
            <Textarea rows={4} {...fieldAria('protocol-description', errors.description?.message)} {...form.register('description')} />
          </FormField>
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
              {isSubmitting ? 'Creating…' : 'Create protocol'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
