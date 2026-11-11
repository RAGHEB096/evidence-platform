import { ImagePlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { STEP_STATUSES, type StepStatus } from '@/domain/status'
import type { EvidenceRow } from '@/features/evidence/api'
import { EvidenceGallery } from '@/features/evidence/EvidenceGallery'
import { EvidenceUploader } from '@/features/evidence/EvidenceUploader'
import type { UploadTarget } from '@/features/evidence/upload'
import { structureKeys } from '@/features/protocols/structure-api'
import { effectiveStatus, hasLiveChildren, type StepNode } from '@/features/protocols/tree'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { getSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const STATUS_ORDER = Object.keys(STEP_STATUSES) as StepStatus[]

export function StepResultCard({
  step,
  depth,
  canRecord,
  evidence,
  uploadTarget,
  maxBytes,
  onOpenEvidence,
}: {
  step: StepNode
  depth: number
  canRecord: boolean
  evidence: EvidenceRow[]
  uploadTarget: UploadTarget
  maxBytes: number
  onOpenEvidence: (row: EvidenceRow) => void
}) {
  const row = step.row
  const queryClient = useQueryClient()
  const directory = useUserDirectory()
  const [actual, setActual] = useState(row.actual_result)
  const [status, setStatus] = useState<StepStatus>(row.status)
  const [comments, setComments] = useState(row.comments)
  const [showUpload, setShowUpload] = useState(false)
  const dirty = actual !== row.actual_result || status !== row.status || comments !== row.comments
  const executor = row.executed_by ? directory.data?.get(row.executed_by) : undefined
  const prefix = `step-${row.id}`
  // A step with sub-steps takes its status from them (ADR-017).
  const derived = hasLiveChildren(step)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().rpc('record_step_result', {
        p_step_id: row.id,
        p_actual_result: actual,
        p_status: status,
        p_comments: comments,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: structureKeys.rows(row.protocol_id) })
      toast.success(`Result for step ${step.number} saved`)
    },
    onError: (error) => toast.error(toUserMessage(error)),
  })

  return (
    <section
      aria-label={`Step ${step.number}`}
      className={cn('space-y-3 rounded-lg border p-4', depth > 0 && 'border-l-4 border-l-muted')}
      style={{ marginLeft: depth * 24 }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="font-semibold">
            Step {step.number}
            {row.reference ? <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{row.reference}</span> : null}
          </h3>
          <p className="text-sm whitespace-pre-wrap">{row.description}</p>
        </div>
        <StatusBadge status={STEP_STATUSES[effectiveStatus(step)]} />
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Expected result</div>
        <p className="whitespace-pre-wrap">{row.expected_result || '—'}</p>
      </div>

      {canRecord ? (
        <form
          className="grid gap-3 md:grid-cols-[1fr_12rem]"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-actual`}>Actual result</Label>
            <Textarea id={`${prefix}-actual`} rows={2} value={actual} onChange={(event) => setActual(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-status`}>Status</Label>
            {derived ? (
              <p id={`${prefix}-status`} className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Follows its sub-steps: <span className="font-medium text-foreground">{STEP_STATUSES[effectiveStatus(step)].label}</span>
              </p>
            ) : (
            <Select value={status} onValueChange={(value) => setStatus(value as StepStatus)}>
              <SelectTrigger id={`${prefix}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STEP_STATUSES[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            )}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`${prefix}-comments`}>Comments</Label>
            <Textarea id={`${prefix}-comments`} rows={1} value={comments} onChange={(event) => setComments(event.target.value)} />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save result'}
            </Button>
            {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Actual result</dt>
          <dd className="whitespace-pre-wrap">{row.actual_result || '—'}</dd>
          <dt className="text-muted-foreground">Comments</dt>
          <dd className="whitespace-pre-wrap">{row.comments || '—'}</dd>
        </dl>
      )}

      {row.executed_at ? (
        <p className="text-xs text-muted-foreground">
          Last recorded {formatDateTime(row.executed_at)}
          {executor ? ` by ${executor.display_name}` : ''}
        </p>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Evidence ({evidence.length})</h4>
          {canRecord ? (
            <Button variant="outline" size="sm" onClick={() => setShowUpload((open) => !open)} aria-expanded={showUpload}>
              <ImagePlusIcon aria-hidden="true" />
              {showUpload ? 'Hide upload' : 'Add evidence'}
            </Button>
          ) : null}
        </div>
        <EvidenceGallery items={evidence} onOpen={(index) => onOpenEvidence(evidence[index]!)} emptyText="No evidence for this step yet." />
        {canRecord && showUpload ? <EvidenceUploader target={uploadTarget} maxBytes={maxBytes} label={`Add evidence to step ${step.number}`} /> : null}
      </div>
    </section>
  )
}
