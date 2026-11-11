import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ProtocolRow } from '@/features/protocols/api'
import { protocolDetailsSchema } from '@/features/protocols/schema'
import { useStructureMutations } from '@/features/protocols/structure-api'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

type Values = z.infer<typeof protocolDetailsSchema>

/** Name, reference, version and description. Editable by managers while the protocol is a draft (ADR-017). */
export function ProtocolDetailsForm({ protocol, canEdit, createdByName }: { protocol: ProtocolRow; canEdit: boolean; createdByName: string }) {
  const { updateProtocol } = useStructureMutations(protocol.id)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(protocolDetailsSchema),
    values: { reference: protocol.reference, name: protocol.name, version: protocol.version, description: protocol.description },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  const readOnly = !canEdit

  async function onSubmit(values: Values) {
    setSubmitError(null)
    try {
      await updateProtocol.mutateAsync(values)
      toast.success('Protocol details saved')
    } catch (error) {
      setSubmitError(toUserMessage(error))
    }
  }

  return (
    <form className="max-w-2xl space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <FormField id="details-reference" label="Reference" error={errors.reference?.message}>
          <Input readOnly={readOnly} {...fieldAria('details-reference', errors.reference?.message)} {...form.register('reference')} />
        </FormField>
        <FormField id="details-version" label="Version" error={errors.version?.message}>
          <Input readOnly={readOnly} {...fieldAria('details-version', errors.version?.message)} {...form.register('version')} />
        </FormField>
      </div>
      <FormField id="details-name" label="Name" error={errors.name?.message}>
        <Input readOnly={readOnly} {...fieldAria('details-name', errors.name?.message)} {...form.register('name')} />
      </FormField>
      <FormField id="details-description" label="Description" error={errors.description?.message}>
        <Textarea rows={6} readOnly={readOnly} {...fieldAria('details-description', errors.description?.message)} {...form.register('description')} />
      </FormField>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Created by</dt>
        <dd>{createdByName}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>{formatDateTime(protocol.created_at)}</dd>
        <dt className="text-muted-foreground">Last modified</dt>
        <dd>{formatDateTime(protocol.updated_at)}</dd>
      </dl>
      {submitError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {submitError}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving…' : 'Save details'}
          </Button>
          <Button type="button" variant="outline" disabled={!isDirty} onClick={() => form.reset()}>
            Discard changes
          </Button>
        </div>
      )}
    </form>
  )
}
