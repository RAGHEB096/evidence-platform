import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { fieldAria } from '@/components/field-aria'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { NodeFields } from '@/features/protocols/structure-api'
import { NODE_LABELS, type NodeType } from '@/features/protocols/tree'
import { toUserMessage } from '@/lib/errors'

const long = (label: string) => z.string().max(10000, `${label} is at most 10,000 characters.`)

const schema = z.object({
  title: z.string(),
  reference: z.string().trim().max(64, 'At most 64 characters.'),
  description: long('The description'),
  expected_result: long('The expected result'),
})

type Values = z.infer<typeof schema>

/** Fields each node type has. Steps have no title: their description is the instruction. */
function fieldsFor(type: NodeType) {
  return {
    title: type !== 'test_step',
    reference: type === 'test_run' || type === 'test_step',
    expected: type === 'test_step',
  }
}

export interface NodeDialogState {
  mode: 'create' | 'edit'
  type: NodeType
  /** Shown in the title, e.g. "under 1.2 Barcode Verification". */
  context?: string
  initial?: NodeFields
  submit: (fields: NodeFields) => Promise<unknown>
}

export function NodeDialog({ state, onClose }: { state: NodeDialogState | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">{state ? <NodeForm key={`${state.mode}-${state.type}-${state.context}`} state={state} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function NodeForm({ state, onClose }: { state: NodeDialogState; onClose: () => void }) {
  const show = fieldsFor(state.type)
  const label = NODE_LABELS[state.type]
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((value, ctx) => {
        if (show.title && !value.title.trim()) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Enter a title.' })
        if (show.title && value.title.trim().length > 200) ctx.addIssue({ code: 'custom', path: ['title'], message: 'At most 200 characters.' })
        if (state.type === 'test_step' && !value.description.trim()) {
          ctx.addIssue({ code: 'custom', path: ['description'], message: 'Describe what the tester does in this step.' })
        }
      }),
    ),
    defaultValues: {
      title: state.initial?.title ?? '',
      reference: state.initial?.reference ?? '',
      description: state.initial?.description ?? '',
      expected_result: state.initial?.expected_result ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: Values) {
    setSubmitError(null)
    const fields: NodeFields = { description: values.description }
    if (show.title) fields.title = values.title.trim()
    if (show.reference) fields.reference = values.reference
    if (show.expected) fields.expected_result = values.expected_result
    try {
      await state.submit(fields)
      onClose()
    } catch (error) {
      setSubmitError(toUserMessage(error))
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.mode === 'create' ? `Add ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}</DialogTitle>
        <DialogDescription>{state.context ?? 'Changes are saved to the database as soon as you save.'}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {show.reference ? (
          <FormField id="node-reference" label="Reference" error={errors.reference?.message} hint="Optional, e.g. TR-001.">
            <Input autoComplete="off" {...fieldAria('node-reference', errors.reference?.message, 'hint')} {...form.register('reference')} />
          </FormField>
        ) : null}
        {show.title ? (
          <FormField id="node-title" label="Title" error={errors.title?.message}>
            <Input autoComplete="off" autoFocus {...fieldAria('node-title', errors.title?.message)} {...form.register('title')} />
          </FormField>
        ) : null}
        <FormField id="node-description" label={state.type === 'test_step' ? 'Instruction' : 'Description'} error={errors.description?.message}>
          <Textarea rows={state.type === 'test_step' ? 3 : 4} autoFocus={!show.title} {...fieldAria('node-description', errors.description?.message)} {...form.register('description')} />
        </FormField>
        {show.expected ? (
          <FormField id="node-expected" label="Expected result" error={errors.expected_result?.message}>
            <Textarea rows={3} {...fieldAria('node-expected', errors.expected_result?.message)} {...form.register('expected_result')} />
          </FormField>
        ) : null}
        {submitError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {submitError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : state.mode === 'create' ? `Add ${label.toLowerCase()}` : 'Save changes'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
